import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createSeed } from './seed.js';
import { fail, type Actor, type Command, type State, type Tx } from './types.js';

const SCHEMA = 1;
export type SaveStage = 'before-backup' | 'before-replace' | 'replace-reported-error' | 'after-replace';
type Fault = (stage: SaveStage) => void;
interface Stored { schemaVersion: number; checksum: string; state: State }
class UncertainCommit extends Error {}

function checksum(state: State): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
      .map(([key, val]) => JSON.stringify(key) + ':' + canonical(val)).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error('Duplicate ' + label);
}

export function validateState(state: State): void {
  if (!Number.isSafeInteger(state.version) || state.version < 0) throw new Error('Invalid state version');
  const hubs = new Set(state.hubs.map((h) => h.id));
  unique(state.hubs.map((h) => h.id), 'hub ID');
  for (const [label, records] of Object.entries(state)) {
    if (Array.isArray(records)) unique(records.map((row: { id: string }) => row.id), label + ' ID');
  }
  const slots = new Map(state.slots.map((slot) => [slot.id, slot]));
  const vehicleIds = new Set([...state.vehicles,...state.privateVehicles].map((vehicle) => vehicle.id));
  unique(state.slots.flatMap((slot) => slot.vehicleId ? [slot.vehicleId] : []), 'physical slot occupant');
  for (const slot of slots.values()) {
    if (!hubs.has(slot.hubId) || (slot.vehicleId && !vehicleIds.has(slot.vehicleId))) throw new Error('Invalid slot reference ' + slot.id);
  }
  for (const v of state.vehicles) {
    if (v.slotId && (slots.get(v.slotId)?.vehicleId !== v.id || slots.get(v.slotId)?.hubId !== v.hubId))
      throw new Error('Vehicle physical location differs from slot ' + v.id);
    if (v.batteryPercent !== null && (!Number.isFinite(v.batteryPercent) || v.batteryPercent < 0 || v.batteryPercent > 100))
      throw new Error('Invalid battery ' + v.id);
  }
  const active = state.holds.filter((hold) => hold.status === 'Held');
  unique(active.filter((hold) => hold.ownerType !== 'PRIVATE_VEHICLE').map((hold) => hold.ownerType + ':' + hold.ownerId), 'destination hold');
  for (const hold of active) {
    if (slots.get(hold.slotId)?.hubId !== hold.hubId || !Number.isFinite(hold.startAt) ||
      (hold.endAt !== null && hold.endAt <= hold.startAt)) throw new Error('Invalid hold ' + hold.id);
    if (active.some((other) => other.id !== hold.id && other.slotId === hold.slotId &&
      other.startAt < (hold.endAt ?? Infinity) && hold.startAt < (other.endAt ?? Infinity)))
      throw new Error('Overlapping slot holds ' + hold.slotId);
  }
  for (const r of state.reservations.filter((r) => r.status === 'Reserved' || r.status === 'UnlockPending')) {
    const vehicle = state.vehicles.find((v) => v.id === r.vehicleId);
    if (vehicle?.allocationOwner?.id !== r.id || vehicle.allocationOwner.type !== 'SHARED_RESERVATION' ||
      !active.some((h) => h.id === r.holdId && h.ownerId === r.id && h.ownerType === 'SHARED_RESERVATION'))
      throw new Error('Reservation owner or hold mismatch ' + r.id);
  }
  for (const trip of state.trips.filter((t) => t.endedAt === null)) {
    const vehicle = state.vehicles.find((v) => v.id === trip.vehicleId);
    if (vehicle?.allocationOwner?.id !== trip.id || vehicle.allocationOwner.type !== 'TRIP' ||
      !active.some((h) => h.id === trip.holdId && h.ownerId === trip.id && h.ownerType === 'TRIP'))
      throw new Error('Trip owner or hold mismatch ' + trip.id);
  }
  for (const order of state.orders) {
    unique(order.items.map(item=>item.id), 'redistribution item ID');
    for (const item of order.items.filter(i=>['Allocated','InTransit','NeedsOperatorAction'].includes(i.status))) {
      const vehicle=state.vehicles.find(v=>v.id===item.vehicleId);
      if (vehicle?.allocationOwner?.type!=='REDISTRIBUTION_ITEM' || vehicle.allocationOwner.id!==item.id ||
        !active.some(h=>h.id===item.holdId && h.ownerType==='REDISTRIBUTION_ITEM' && h.ownerId===item.id))
        throw new Error('Redistribution owner or hold mismatch ' + item.id);
    }
  }
  unique(state.invoices.map((invoice) => invoice.tripId), 'invoice for trip');
  for (const point of state.points) {
    if (!hubs.has(point.hubId) || (point.pluggedVehicleId && !vehicleIds.has(point.pluggedVehicleId))) throw new Error('Invalid charging point ' + point.id);
  }
}

async function decode(path: string): Promise<State> {
  const row = JSON.parse(await readFile(path,'utf8')) as Stored;
  if (row.schemaVersion !== SCHEMA || checksum(row.state) !== row.checksum) throw new Error('Invalid snapshot checksum or schema');
  validateState(row.state);
  return row.state;
}

async function writeAtomicTemp(path: string, data: string): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const lockedActor: Actor = { id: 'DEVICE_SIMULATOR', role: 'SYSTEM' };

export class Store {
  private serial: Promise<void> = Promise.resolve();
  private listeners = new Set<(version: number) => void>();
  private state: State;
  private primaryTrusted: boolean;
  recoveryReason: string | null;

  private constructor(private readonly directory: string, state: State, recoveryReason: string | null,
    readonly clock: () => number, private readonly fault?: Fault) {
    this.state = state;
    this.recoveryReason = recoveryReason;
    this.primaryTrusted = recoveryReason === null;
  }

  static async open(directory: string, clock = Date.now, fault?: Fault, slotsPerHub = 15): Promise<Store> {
    await mkdir(directory, { recursive: true });
    let mainIssue: unknown;
    try { return new Store(directory, await decode(join(directory, 'snapshot.json')), null, clock, fault); }
    catch (err) { mainIssue = err; }
    try {
      const backup = await decode(join(directory, 'snapshot.prev.json'));
      return new Store(directory, backup, 'Đã nạp bản dự phòng (phiên bản ' + backup.version + '). Cần đối soát trước khi ghi.', clock, fault);
    } catch (backupIssue) {
      const fileMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';
      const marker = await readFile(join(directory, '.initialized'), 'utf8').catch((err) => {
        if (!fileMissing(err)) throw err;
        return null;
      });
      if (!fileMissing(mainIssue) || !fileMissing(backupIssue) || marker !== null)
        throw new Error('Không nạp được snapshot chính hoặc dự phòng. Dữ liệu gốc được giữ để phục hồi.');
    }
    const store = new Store(directory, createSeed(clock(), slotsPerHub), null, clock, fault);
    validateState(store.state);
    await store.save(store.state, true);
    await writeAtomicTemp(join(directory,'.initialized'), 'Smart E-Mobility Hub runtime\n');
    return store;
  }

  get version(): number { return this.state.version; }
  snapshot(): State { return structuredClone(this.state); }
  subscribe(fn: (version: number) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private tx(state: State, actor: Actor): Tx {
    const now = this.clock();
    const id = (prefix: string) => prefix + '-' + randomUUID();
    return {
      state, actor, now, id,
      log(type, resourceId, detail) {
        state.activity.push({id:id('EVT'),type,actorId:actor.id,at:now,resourceId,detail});
      },
      notify(userId, message) {
        state.notifications.push({id:id('NTF'),userId,message,createdAt:now,readAt:null});
      },
      command(type, resourceId, subjectId) {
        const command: Command = {
          id:id('CMD'),type,resourceId,subjectId,createdAt:now,expiresAt:now+60_000,status:'Pending',
          dispatchedAt:null,attempts:0,nextProbeAt:null,probeCount:0,
        };
        state.commands.push(command);
        return command;
      },
    };
  }

  read<T>(actor: Actor, fn: (tx: Tx) => T): { data: T; stateVersion: number } {
    return {data:fn(this.tx(this.snapshot(), actor)),stateVersion:this.version};
  }

  private async save(state: State, initialize = false): Promise<void> {
    const main = join(this.directory,'snapshot.json');
    const backup = join(this.directory,'snapshot.prev.json');
    const mainTemp = main + '.' + randomUUID() + '.tmp';
    const backupTemp = backup + '.' + randomUUID() + '.tmp';
    const serialized = (s: State) => JSON.stringify({schemaVersion:SCHEMA,checksum:checksum(s),state:s});
    try {
      await writeAtomicTemp(mainTemp, serialized(state));
      await decode(mainTemp);
      if (!initialize && this.primaryTrusted) {
        this.fault?.('before-backup');
        const old = await decode(main);
        await writeAtomicTemp(backupTemp, serialized(old));
        await rename(backupTemp, backup);
      }
      this.fault?.('before-replace');
      try {
        await rename(mainTemp, main);
        this.fault?.('replace-reported-error');
      } catch {
        this.recoveryReason = 'Chưa xác định kết quả lưu snapshot. Đã tạm dừng ghi để đối soát.';
        this.primaryTrusted = false;
        try { this.state = await decode(main); } catch { /* Keep the last validated in-memory version. */ }
        throw new UncertainCommit();
      }
      this.primaryTrusted = true;
      this.fault?.('after-replace');
    } finally {
      await Promise.allSettled([unlink(mainTemp),unlink(backupTemp)]);
    }
  }

  async write<T>(actor: Actor, fn: (tx: Tx) => T, options: {
    requestId?:string; operation?:string; payload?:unknown; recovery?:boolean;
  } = {}): Promise<{data:T;stateVersion:number}> {
    let unlock!: () => void;
    const previous = this.serial;
    this.serial = new Promise<void>((resolve) => { unlock = resolve; });
    let published: number | undefined;
    try {
      await previous;
      // Policy checks in the route are evaluated before a request can reach this store.
      const key = options.requestId ? actor.id + ':' + options.requestId : undefined;
      const hash = options.requestId ? createHash('sha256').update(canonical(options.payload)).digest('hex') : '';
      const prior = key ? this.state.idempotency[key] : undefined;
      if (prior) {
        if (prior.operation !== options.operation || prior.hash !== hash)
          fail(409,'IDEMPOTENCY_CONFLICT','Mã yêu cầu đã được dùng cho thao tác khác.');
        return {data:structuredClone(prior.data) as T,stateVersion:prior.stateVersion};
      }
      if (this.recoveryReason && !options.recovery) fail(503,'RECOVERY',this.recoveryReason);
      const draft = this.snapshot();
      const data = fn(this.tx(draft, actor));
      if (!key && JSON.stringify(draft) === JSON.stringify(this.state))
        return {data,stateVersion:this.version};
      draft.version = this.version + 1;
      if (key) draft.idempotency[key] = {operation:options.operation!,hash,data:structuredClone(data),stateVersion:draft.version};
      validateState(draft);
      try { await this.save(draft); }
      catch (err) {
        if (err instanceof UncertainCommit) fail(503,'COMMIT_UNCERTAIN','Chưa xác định kết quả lưu. Kiểm tra trạng thái trước khi gửi lệnh mới.');
        if (this.primaryTrusted) {
          const actual = await decode(join(this.directory, 'snapshot.json')).catch(() => undefined);
          if (actual?.version === draft.version) {
            this.state = actual;
            published = actual.version;
            fail(503,'RESPONSE_INTERRUPTED','Giao dịch đã lưu. Gửi lại cùng mã yêu cầu để nhận kết quả.');
          }
        }
        fail(503,'SNAPSHOT_WRITE_FAILED','Không lưu được snapshot. Giao dịch chưa được công bố.');
      }
      this.state = draft;
      published = draft.version;
      return {data:structuredClone(data),stateVersion:draft.version};
    } finally {
      unlock();
      if (published !== undefined) for (const listener of this.listeners) {
        try { listener(published); } catch { /* Notifications are best effort. */ }
      }
    }
  }

  system<T>(fn: (tx: Tx) => T, recovery = false) {
    return this.write(lockedActor, fn, {recovery});
  }

  async recover(operator: Actor): Promise<void> {
    if (!this.recoveryReason) return;
    await this.write(operator, (tx) => {
      if (tx.state.commands.some((c) => c.status === 'Pending'))
        fail(409,'DEVICE_PENDING','Cần đối soát tất cả lệnh đang chờ trước khi thoát phục hồi.');
      tx.log('RECOVERY_CONFIRMED','snapshot','Operator đã đối soát snapshot và dữ liệu thiết bị.');
    }, {recovery:true});
    this.recoveryReason = null;
  }

  async close(): Promise<void> { await this.serial; }
}
