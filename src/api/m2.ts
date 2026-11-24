import {
  checkVersion, entity, fail, fresh, instant, number, owned, requiredString,
  type AddRoute, type Command, type Hold, type Incident, type Input, type ParkingBooking,
  type PlanAssignment, type Point, type Session, type Slot, type State, type Tx,
} from './types.js';
import { applyReservationIncident, applyVehicleChargingState, applyVehicleHealth } from './m1.js';
import { applyIncidentImpact } from './m3.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const VIETNAM_OFFSET = 7 * 60 * MINUTE;
const MAX_REPEAT_DAYS = 84;
const RECENT_RETURN = 30 * MINUTE;

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function chargeEnergyAndDuration(capacityKWh: number, currentPercent: number, target: number, powerKW: number) {
  const energyKWh = capacityKWh * (target - currentPercent) / 100;
  return { energyKWh, durationMinutes: Math.ceil(energyKWh / powerKW * 60) };
}

export function parkingAlertOpen(previous: boolean, occupied: number, capacity: number): boolean {
  if (capacity === 0) return false;
  const percent = occupied * 100 / capacity;
  return previous ? percent >= 85 : percent >= 90;
}

const freshHub = (state: State, hubId: string, now: number) => {
  const hub = entity(state.hubs, hubId, 'Hub');
  return hub.lastSeenAt !== null && now >= hub.lastSeenAt && now - hub.lastSeenAt <= 10_000;
};
const activeHold = (hold: Hold) => hold.status === 'Held' || hold.status === 'Occupied';
const activeSession = (s: Session) => s.status === 'Starting' || s.status === 'Charging' || s.status === 'StopPending';
const openSession = (s: Session) => activeSession(s) || s.status === 'Waiting' || s.status === 'Scheduled';
const reservesPoint = (s: Session) => activeSession(s) || s.status === 'Scheduled';
const endOfPower = (s: Session) => s.status === 'StopPending' || s.status === 'Starting' ? Infinity : s.endAt;

function canUseSlot(state: State, slot: Slot, startAt: number, endAt: number, exceptHoldId?: string, requireEmpty = true): boolean {
  return !slot.blocked && (!requireEmpty || slot.vehicleId === null)
    && !state.holds.some(h => h.slotId === slot.id && h.id !== exceptHoldId && activeHold(h)
      && overlaps(startAt, endAt, h.startAt, h.endAt ?? Infinity));
}

function holdSlot(tx: Tx, slot: Slot, ownerType: Hold['ownerType'], ownerId: string, startAt: number, endAt: number | null): Hold {
  const hold: Hold = { id: tx.id('hold'), slotId: slot.id, hubId: slot.hubId, ownerType, ownerId, startAt, endAt, status: 'Held' };
  tx.state.holds.push(hold);
  return hold;
}

function ownHold(tx: Tx, id: string, type: Hold['ownerType'], ownerId: string): Hold {
  const hold = entity(tx.state.holds, id, 'lượt giữ chỗ');
  if (hold.ownerType !== type || hold.ownerId !== ownerId) fail(409, 'HOLD_OWNER_CONFLICT', 'Lượt giữ chỗ thuộc giao dịch khác.');
  return hold;
}

function chooseSharedSlot(tx: Tx, hubId: string, exceptHoldId?: string): Slot {
  entity(tx.state.hubs, hubId, 'Hub');
  const slot = freshHub(tx.state, hubId, tx.now) && !parkingBlocked(tx.state, hubId)
    ? tx.state.slots.find(s => s.hubId === hubId && s.type === 'SHARED' && canUseSlot(tx.state, s, tx.now, Infinity, exceptHoldId))
    : undefined;
  if (slot) return slot;
  const alternatives = tx.state.hubs.filter(h => h.id !== hubId && freshHub(tx.state, h.id, tx.now) && !parkingBlocked(tx.state, h.id))
    .filter(h => tx.state.slots.some(s => s.hubId === h.id && s.type === 'SHARED' && canUseSlot(tx.state, s, tx.now, Infinity)))
    .map(h => ({ id:h.id, name:h.name }));
  return fail(409, 'NO_PARKING_CAPACITY', 'Hub đích không còn chỗ đỗ khả dụng.', { alternatives });
}

export function reserveDestination(tx: Tx, hubId: string, ownerType: Hold['ownerType'], ownerId: string): Hold {
  if (tx.state.holds.some(h => h.ownerType === ownerType && h.ownerId === ownerId && h.status === 'Held'))
    fail(409, 'HOLD_OWNER_CONFLICT', 'Giao dịch đã có chỗ đích.');
  return holdSlot(tx, chooseSharedSlot(tx, hubId), ownerType, ownerId, tx.now, null);
}

export function changeDestination(tx: Tx, holdId: string, newHubId: string, ownerType: Hold['ownerType'], ownerId: string): Hold {
  const hold = ownHold(tx, holdId, ownerType, ownerId);
  if (hold.status !== 'Held') fail(409, 'INVALID_TRANSITION', 'Lượt giữ chỗ không còn hiệu lực.');
  if (hold.hubId === newHubId) return hold;
  const slot = chooseSharedSlot(tx, newHubId, hold.id);
  hold.hubId = slot.hubId;
  hold.slotId = slot.id;
  return hold;
}

export function transferDestination(tx: Tx, holdId: string, fromType: Hold['ownerType'], fromId: string, toType: Hold['ownerType'], toId: string): Hold {
  const hold = ownHold(tx, holdId, fromType, fromId);
  if (hold.status !== 'Held') fail(409, 'INVALID_TRANSITION', 'Lượt giữ chỗ không còn hiệu lực.');
  if (tx.state.holds.some(h => h.id !== holdId && h.ownerType === toType && h.ownerId === toId && h.status === 'Held'))
    fail(409, 'HOLD_OWNER_CONFLICT', 'Giao dịch đích đã có chỗ đỗ.');
  hold.ownerType = toType;
  hold.ownerId = toId;
  return hold;
}

export function releaseDestination(tx: Tx, holdId: string, ownerType: Hold['ownerType'], ownerId: string): void {
  const hold = ownHold(tx, holdId, ownerType, ownerId);
  if (hold.status === 'Held') hold.status = 'Released';
}

export function arriveDestination(tx: Tx, holdId: string, ownerType: Hold['ownerType'], ownerId: string, vehicleId: string, preferredSlotId?: string): Slot {
  const hold = ownHold(tx, holdId, ownerType, ownerId);
  if (hold.status !== 'Held') fail(409, 'INVALID_TRANSITION', 'Lượt giữ chỗ không còn hiệu lực.');
  const reserved = entity(tx.state.slots, hold.slotId, 'chỗ đỗ đích');
  if (preferredSlotId && preferredSlotId !== reserved.id) fail(409, 'WRONG_SLOT', 'Vị trí trả xe khác chỗ đích đang giữ.');
  if (!canUseSlot(tx.state, reserved, tx.now, Infinity, hold.id))
    fail(409, 'DESTINATION_BLOCKED', 'Chỗ đỗ đích bị chiếm hoặc bị khóa. Cần Operator xác nhận vị trí thay thế.');
  if (tx.state.slots.some(s => s.vehicleId === vehicleId && s.id !== reserved.id))
    fail(409, 'VEHICLE_ALREADY_PARKED', 'Xe vẫn được ghi nhận ở chỗ đỗ khác.');
  reserved.vehicleId = vehicleId;
  hold.status = 'Released';
  hold.endAt = tx.now;
  return reserved;
}

export function reassignBlockedDestination(
  tx: Tx, holdId: string, ownerType: Hold['ownerType'], ownerId: string, verifiedSlotId?: string,
): Hold | null {
  const hold = ownHold(tx, holdId, ownerType, ownerId);
  if (hold.status !== 'Held') fail(409, 'INVALID_TRANSITION', 'Lượt giữ chỗ không còn hiệu lực.');
  const blocked = entity(tx.state.slots, hold.slotId, 'chỗ đỗ đích');
  if (canUseSlot(tx.state, blocked, tx.now, Infinity, hold.id) || (!verifiedSlotId && !tx.state.demo.autoAck)) return null;

  const replacement = tx.state.slots.find(s => s.hubId === hold.hubId && s.type === 'SHARED'
    && (!verifiedSlotId || s.id === verifiedSlotId) && canUseSlot(tx.state, s, tx.now, Infinity, hold.id));
  if (!replacement) return null;
  hold.slotId = replacement.id;
  hold.startAt = tx.now;
  tx.log('DESTINATION_REASSIGNED', hold.id, 'Đổi ' + blocked.id + ' sang ' + replacement.id + ' trong cùng Hub.');
  return hold;
}

export function releaseOccupied(tx: Tx, slotId: string, vehicleId: string): void {
  const slot = entity(tx.state.slots, slotId, 'chỗ đỗ nguồn');
  if (slot.vehicleId !== vehicleId) fail(409, 'SLOT_OCCUPANCY_CONFLICT', 'Xe không đứng ở chỗ đỗ đã ghi nhận.');
  slot.vehicleId = null;
}

function parkingBlocked(state: State, hubId: string): boolean {
  const slots = state.slots.filter(s => s.hubId === hubId);
  return parkingAlertOpen(state.alerts.some(a => a.hubId === hubId && a.type === 'PARKING' && a.status === 'Open'),
    slots.filter(s => s.vehicleId !== null).length, slots.length);
}

function expandParkingDates(start: number, end: number, repeat: unknown): { start: number; end: number }[] {
  if (repeat === undefined || repeat === null) return [{ start, end }];
  if (typeof repeat !== 'object' || Array.isArray(repeat)) return fail(400, 'INVALID_RECURRENCE', 'Lịch lặp không hợp lệ.');
  const rule = repeat as Record<string, unknown>;
  const last = rule.endDate;
  const weekdays = rule.weekdays;
  if (typeof last !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(last) || !Array.isArray(weekdays) || !weekdays.length || weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6))
    return fail(400, 'INVALID_RECURRENCE', 'Cần ngày kết thúc và các thứ trong tuần (0 đến 6).');
  const localStartDay = Math.floor((start + VIETNAM_OFFSET) / DAY) * DAY;
  const localEndDay = Date.parse(last + 'T00:00:00Z');
  if (!Number.isFinite(localEndDay) || new Date(localEndDay).toISOString().slice(0,10) !== last
    || localEndDay < localStartDay || localEndDay - localStartDay >= MAX_REPEAT_DAYS * DAY || end - start > DAY)
    return fail(400, 'INVALID_RECURRENCE', 'Lịch lặp tối đa 12 tuần và mỗi lần không quá 24 giờ.');
  const ranges = [];
  for (let day = localStartDay; day <= localEndDay; day += DAY) {
    if (!weekdays.includes(new Date(day).getUTCDay())) continue;
    const shift = day - localStartDay;
    ranges.push({ start: start + shift, end: end + shift });
  }
  if (!ranges.length) return fail(400, 'INVALID_RECURRENCE', 'Không có buổi nào theo lịch lặp.');
  return ranges;
}

function parkingPreview(tx: Tx, input: Input) {
  const vehicle = entity(tx.state.privateVehicles, requiredString(input, 'privateVehicleId'), 'xe cá nhân');
  owned(tx, vehicle.userId);
  const hubId = requiredString(input, 'hubId');
  entity(tx.state.hubs, hubId, 'Hub');
  const start = instant(input, 'startAt');
  const end = instant(input, 'endAt');
  if (end <= start || end <= tx.now) fail(400, 'INVALID_INTERVAL', 'Khoảng đỗ phải kết thúc sau khi bắt đầu và còn hiệu lực.');
  const entries = expandParkingDates(start, end, input.repeat).map(range => {
    const vehicleBooked = tx.state.bookings.some(b => b.vehicleId === vehicle.id
      && (b.status === 'Scheduled' || b.status === 'InUse') && overlaps(range.start, range.end, b.startAt, b.endAt));
    const slot = !vehicleBooked && range.end > tx.now && freshHub(tx.state, hubId, tx.now) && !parkingBlocked(tx.state, hubId)
      ? tx.state.slots.find(s => s.hubId === hubId && s.type === 'PRIVATE' && canUseSlot(tx.state, s, range.start, range.end, undefined, true))
      : undefined;
    return { startAt: range.start, endAt: range.end, slotId: slot?.id ?? null, available: !!slot,
      costVnd: Math.ceil((range.end - range.start) / (60 * MINUTE)) * 2_000,
      reason: slot ? null : vehicleBooked ? 'VEHICLE_TIME_CONFLICT' : 'NO_PARKING_CAPACITY' };
  });
  return { vehicle, hubId, entries, costVnd: entries.filter(e => e.available).reduce((sum, e) => sum + e.costVnd, 0) };
}

function confirmParking(tx: Tx, input: Input) {
  const preview = parkingPreview(tx, input);
  const skipped = preview.entries.filter(e => e.slotId === null);
  if (skipped.length && input.skipConflicts !== true)
    fail(409, 'TIME_SLOT_CONFLICT', 'Có buổi không đặt được. Xem lại lịch hoặc bật bỏ qua buổi xung đột.', { skipped });
  const bookings: ParkingBooking[] = [];
  for (const e of preview.entries) {
    if (!e.slotId) continue;
    const slot = entity(tx.state.slots, e.slotId, 'chỗ đỗ');
    const b: ParkingBooking = {
      id:tx.id('parking'), hubId:preview.hubId, userId:preview.vehicle.userId, vehicleId:preview.vehicle.id,
      slotId:slot.id, holdId:holdSlot(tx, slot, 'PRIVATE_VEHICLE', preview.vehicle.id, e.startAt, e.endAt).id,
      startAt:e.startAt, endAt:e.endAt, status:'Scheduled', serviceStatus:'Normal', guarantee:'Guaranteed', costVnd:e.costVnd, version:1,
    };
    tx.state.bookings.push(b);
    bookings.push(b);
    tx.log('PARKING_BOOKED', b.id, 'Lưu lịch đỗ xe cá nhân');
  }
  return { bookings, skipped };
}

function arriveParking(tx: Tx, b: ParkingBooking) {
  if (b.status === 'InUse') return b;
  if (b.status !== 'Scheduled' || tx.now < b.startAt || tx.now >= b.endAt)
    fail(409, 'INVALID_TRANSITION', 'Chỉ ghi nhận xe vào bãi trong khoảng đỗ đã đặt.');
  const hold = ownHold(tx, b.holdId, 'PRIVATE_VEHICLE', b.vehicleId);
  if (hold.status !== 'Held') fail(409, 'INVALID_TRANSITION', 'Lượt giữ chỗ không còn hiệu lực.');
  const original = entity(tx.state.slots, b.slotId, 'chỗ đỗ');
  const parkingElsewhere = tx.state.slots.some(s => s.vehicleId === b.vehicleId);
  const fits = (s: Slot) => s.hubId === b.hubId && s.type === 'PRIVATE' && canUseSlot(tx.state, s, tx.now, b.endAt, hold.id);
  const slot = parkingElsewhere ? undefined : fits(original) ? original : tx.state.slots.find(fits);
  if (!slot) {
    if (b.serviceStatus !== 'Delayed') tx.notify(b.userId, 'Xe chưa có chỗ vật lý tại Hub. Lượt đỗ đang trễ, vui lòng thử lại.');
    b.serviceStatus = 'Delayed';
    b.guarantee = 'NotGuaranteed';
    b.version++;
    return b;
  }
  b.slotId = slot.id;
  hold.slotId = slot.id;
  slot.vehicleId = b.vehicleId;
  hold.status = 'Occupied';
  b.status = 'InUse';
  b.serviceStatus = 'Normal';
  b.guarantee = 'Guaranteed';
  b.version++;
  tx.log('PARKING_ARRIVAL', b.id, 'Xác nhận xe cá nhân đã vào vị trí đỗ.');
  return b;
}

function departParking(tx: Tx, b: ParkingBooking) {
  if (b.status === 'Completed') return b;
  if (b.status !== 'InUse') fail(409, 'INVALID_TRANSITION', 'Xe chưa được xác nhận vào chỗ đỗ.');
  if (tx.state.points.some(p => p.pluggedVehicleId === b.vehicleId)
    || tx.state.sessions.some(s => s.bookingId === b.id && activeSession(s)))
    fail(409, 'DEVICE_PENDING', 'Cần dừng sạc và rút đầu cắm trước khi rời bãi.');
  releaseOccupied(tx, b.slotId, b.vehicleId);
  const hold = ownHold(tx, b.holdId, 'PRIVATE_VEHICLE', b.vehicleId);
  hold.status = 'Released';
  hold.endAt = tx.now;
  for (const s of tx.state.sessions.filter(s => s.bookingId === b.id && openSession(s))) stopCharging(tx, s, 'Cancelled');
  b.status = 'Completed';
  b.version++;
  tx.log('PARKING_DEPARTURE', b.id, 'Xác nhận xe cá nhân đã rời chỗ đỗ.');
  return b;
}

function validInterval(start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && start < end;
}

export function checkWindow(state: State, hubId: string, startAt: number, endAt: number, powerKW: number, excludeSessionId?: string): boolean {
  const hub = state.hubs.find(h => h.id === hubId);
  if (!hub) return false;
  const existing = state.sessions.filter(s => s.id !== excludeSessionId && s.hubId === hubId && reservesPoint(s))
    .map(s => ({start:s.startAt,end:endOfPower(s),kw:s.powerKW}));
  return fitsPowerWindow(hub.powerLimitKW,startAt,endAt,powerKW,existing);
}

export function fitsPowerWindow(limit: number, start: number, end: number, kw: number,
  windows: ReadonlyArray<{start: number; end: number | null; kw?: number}>): boolean {
  if (!validInterval(start,end) || !Number.isFinite(kw) || kw <= 0 || kw > limit) return false;
  const existing = windows.filter(window => overlaps(start,end,window.start,window.end ?? Infinity));
  const checkpoints = [start, ...existing.map(window => window.start).filter(at => at > start && at < end)];
  return checkpoints.every(at => kw + existing.reduce((sum, window) =>
    window.start <= at && at < (window.end ?? Infinity) ? sum + (window.kw ?? 0) : sum, 0) <= limit + 1e-9);
}

function connector(state: State, s: Pick<Session, 'private' | 'vehicleId'>) {
  return s.private
    ? entity(state.privateVehicles, s.vehicleId, 'xe cá nhân').connectorType
    : entity(state.vehicles, s.vehicleId, 'xe dùng chung').connectorType;
}

function capacity(state: State, s: Pick<Session, 'private' | 'vehicleId'>) {
  return s.private
    ? entity(state.privateVehicles, s.vehicleId, 'xe cá nhân').capacityKWh
    : entity(state.vehicles, s.vehicleId, 'xe dùng chung').capacityKWh;
}

function compatiblePoint(state: State, point: Point, session: Session): boolean {
  return !point.blocked && point.hubId === session.hubId && point.connectorType === connector(state, session);
}

export function canScheduleCharge(state: State, assignment: PlanAssignment): boolean {
  const s = state.sessions.find(row => row.id === assignment.sessionId);
  const p = state.points.find(row => row.id === assignment.pointId);
  if (!s || !p || !compatiblePoint(state, p, s) || assignment.powerKW > p.ratedKW
    || s.requestedPointId !== null && s.requestedPointId !== p.id
    || p.pluggedVehicleId !== null && p.pluggedVehicleId !== s.vehicleId
    || state.points.some(p2 => p2.id !== p.id && p2.pluggedVehicleId === s.vehicleId)
    || p.powered && !activeSession(s)) return false;
  if (!validInterval(assignment.startAt, assignment.endAt)) return false;
  const duration = chargeEnergyAndDuration(capacity(state, s), s.currentPercent, s.targetPercent, assignment.powerKW).durationMinutes;
  if (assignment.endAt - assignment.startAt < duration * MINUTE) return false;
  if (s.private) {
    const b = state.bookings.find(row => row.id === s.bookingId);
    if (!b || b.vehicleId !== s.vehicleId || b.userId !== s.userId || b.hubId !== s.hubId || (b.status !== 'Scheduled' && b.status !== 'InUse')
      || assignment.startAt < b.startAt || assignment.endAt > b.endAt) return false;
  }
  return checkWindow(state, s.hubId, assignment.startAt, assignment.endAt, assignment.powerKW, s.id)
    && !state.sessions.some(other => other.id !== s.id && reservesPoint(other)
      && (other.pointId === p.id || other.vehicleId === s.vehicleId)
      && overlaps(assignment.startAt, assignment.endAt, other.startAt, endOfPower(other)));
}

export function applyChargingAssignments(tx: Tx, hubId: string, assignments: PlanAssignment[]): string[] {
  const ids = new Set(assignments.map(a => a.sessionId));
  if (ids.size !== assignments.length) fail(400, 'INVALID_INPUT', 'Kế hoạch có phiên lặp.');
  const scratch: State = { ...tx.state, sessions: tx.state.sessions.map(s => ids.has(s.id) && s.status === 'Scheduled' ? { ...s, status: 'Waiting' } : { ...s }) };
  for (const a of assignments) {
    const s = entity(scratch.sessions, a.sessionId, 'phiên sạc');
    if (s.hubId !== hubId || s.status !== 'Waiting' || a.startAt < tx.now || !canScheduleCharge(scratch, a))
      fail(409, 'CHARGING_PLAN_CONFLICT', 'Kế hoạch sạc không còn khả thi. Tải lại tài nguyên và lập lại kế hoạch.', { sessionId:a.sessionId });
    Object.assign(s, { pointId:a.pointId, startAt:a.startAt, endAt:a.endAt, powerKW:a.powerKW, status:'Scheduled' });
  }
  for (const a of assignments) {
    const s = entity(tx.state.sessions, a.sessionId, 'phiên sạc');
    const changed = s.status === 'Scheduled' && (s.pointId !== a.pointId || s.startAt !== a.startAt);
    Object.assign(s, { pointId:a.pointId, startAt:a.startAt, endAt:a.endAt, powerKW:a.powerKW, status:'Scheduled', version:s.version + 1 });
    if (changed) tx.notify(s.userId, 'Lịch sạc của bạn đã được điều chỉnh.');
  }
  return assignments.map(a => a.sessionId);
}

function blankSession(tx: Tx, data: {
  hubId: string; vehicleId: string; userId:string; private:boolean; bookingId?:string; requestedPointId?:string;
  startAt:number; endAt:number; powerKW:number; currentPercent:number; targetPercent:number; neededAt?:number;
}): Session {
  return {
    id:tx.id('charge'), hubId:data.hubId, vehicleId:data.vehicleId, userId:data.userId,
    private:data.private, bookingId:data.bookingId ?? null, requestedPointId:data.requestedPointId ?? null,
    pointId:null, startAt:data.startAt, endAt:data.endAt, powerKW:data.powerKW, currentPercent:data.currentPercent,
    targetPercent:data.targetPercent, status:'Waiting', commandId:null, waitingSince:tx.now, neededAt:data.neededAt ?? null,
    version:1, startedAt:null, updatedAt:tx.now,
  };
}

function stopCharging(tx: Tx, s: Session, finalStatus: NonNullable<Session['desiredStop']>) {
  if (s.status === 'Scheduled' || s.status === 'Waiting') {
    s.status = finalStatus === 'Failed' ? 'Failed' : 'Cancelled';
    s.desiredStop = finalStatus;
    s.version++;
    s.updatedAt = tx.now;
    return s;
  }
  if (s.status === 'StopPending' || !activeSession(s)) return s;
  const replaced = tx.state.commands.find(c => c.id === s.commandId && c.type === 'CHARGE_START' && c.status === 'Pending');
  if (replaced && replaced.dispatchedAt === null) replaced.status = 'Failed';
  s.commandId = tx.command('CHARGE_STOP', s.pointId!, s.id).id;
  s.status = 'StopPending';
  s.desiredStop = finalStatus;
  s.version++;
  s.updatedAt = tx.now;
  tx.log('CHARGE_STOP_REQUESTED', s.id, finalStatus);
  return s;
}

function beginCharging(tx: Tx, s: Session, point: Point, a: PlanAssignment) {
  s.pointId = point.id;
  s.startAt = a.startAt;
  s.endAt = a.endAt;
  s.powerKW = a.powerKW;
  s.commandId = tx.command('CHARGE_START', point.id, s.id).id;
  s.status = 'Starting';
  s.version++;
  s.updatedAt = tx.now;
  tx.log('CHARGE_START_REQUESTED', s.id, point.id);
}

function bookingForPrivate(tx: Tx, input: Input) {
  const id = requiredString(input, typeof input.bookingId === 'string' ? 'bookingId' : 'parkingRef');
  const b = entity(tx.state.bookings, id, 'lượt đặt chỗ đỗ');
  owned(tx, b.userId);
  const vehicle = entity(tx.state.privateVehicles, b.vehicleId, 'xe cá nhân');
  if (input.privateVehicleId !== undefined && input.privateVehicleId !== vehicle.id)
    fail(409, 'PARKING_VEHICLE_MISMATCH', 'Xe không khớp lượt đặt chỗ.');
  if (b.status !== 'Scheduled' && b.status !== 'InUse') fail(409, 'PARKING_REQUIRED', 'Cần một lịch đỗ còn hiệu lực.');
  return { b, vehicle };
}

function chargingPreview(tx: Tx, input: Input) {
  const { b, vehicle } = bookingForPrivate(tx, input);
  const startAt = instant(input, 'startAt');
  const currentPercent = number(input, 'currentPercent');
  const targetPercent = input.target === undefined ? 80 : number(input, 'target');
  const powerKW = number(input, 'powerKW');
  if (currentPercent < 0 || targetPercent > 100 || targetPercent <= currentPercent || powerKW <= 0)
    fail(400, 'INVALID_CHARGE_TARGET', 'Mức pin mục tiêu phải cao hơn mức hiện tại, tối đa 100%, và công suất phải dương.');
  const requestedPointId = typeof input.pointId === 'string' && input.pointId ? input.pointId : undefined;
  const energy = chargeEnergyAndDuration(vehicle.capacityKWh, currentPercent, targetPercent, powerKW);
  const s: Session = {
    id:'preview', hubId:b.hubId, vehicleId:vehicle.id, userId:b.userId, private:true, bookingId:b.id,
    requestedPointId:requestedPointId ?? null, pointId:null, startAt, endAt:startAt + energy.durationMinutes * MINUTE,
    powerKW, currentPercent, targetPercent, status:'Waiting', commandId:null, waitingSince:tx.now,
    neededAt:b.endAt, startedAt:null, updatedAt:tx.now, version:1,
  };
  const scope: State = { ...tx.state, sessions:[...tx.state.sessions, s] };
  const points = tx.state.points.filter(p => p.hubId === b.hubId && (!requestedPointId || p.id === requestedPointId));
  const available = (pointId: string, start: number, end: number, power: number) => start >= tx.now && freshHub(tx.state, b.hubId, tx.now)
    && canScheduleCharge(scope, { sessionId:s.id, pointId, startAt:start, endAt:end, powerKW:power, priority:0 });
  const choices = points.map(p => ({
    pointId:p.id, startAt:s.startAt, endAt:s.endAt, powerKW,
    available:available(p.id, s.startAt, s.endAt, powerKW),
  }));
  const suggestions = [];
  if (!choices.some(c => c.available)) {
    for (const p of points.filter(p => compatiblePoint(scope, p, s))) {
      const rates = [...new Set([Math.min(powerKW, p.ratedKW), Math.min(powerKW, p.ratedKW, 1)])];
      for (const rate of rates) {
        const duration = chargeEnergyAndDuration(vehicle.capacityKWh, currentPercent, targetPercent, rate).durationMinutes * MINUTE;
        const earliest = Math.max(tx.now, b.startAt, startAt);
        const maxTicks = Math.min(48, Math.ceil((b.endAt - earliest) / (15 * MINUTE)));
        for (let step = 0; step <= maxTicks; step++) {
          const start = earliest + 15 * MINUTE * step;
          const end = start + duration;
          if (end > b.endAt) break;
          if (!available(p.id, start, end, rate)) continue;
          suggestions.push({ pointId:p.id, startAt:start, endAt:end, powerKW:rate, available:true });
          break;
        }
      }
    }
  }
  return { draft:s, options:{ ...energy, startAt, endAt:s.endAt, choices, suggestions } };
}

function bookCharging(tx: Tx, input: Input) {
  const { draft, options } = chargingPreview(tx, input);
  const choice = options.choices.find(c => c.available);
  if (!choice) fail(409, 'POWER_CAPACITY_EXCEEDED', 'Không có cổng và công suất phù hợp trong thời gian đỗ đã chọn.', options);
  const creation: Session = {
    ...draft, id:tx.id('charge'), pointId:choice.pointId, status:'Scheduled',
  };
  tx.state.sessions.push(creation);
  tx.log('CHARGE_BOOKED', creation.id, choice.pointId);
  return creation;
}

function stageSharedCharging(tx: Tx, input: Input) {
  const v = entity(tx.state.vehicles, requiredString(input, 'vehicleId'), 'xe dùng chung');
  const existing = tx.state.sessions.find(s => s.vehicleId === v.id && openSession(s));
  if (existing) {
    owned(tx, existing.userId);
    const request = tx.state.chargingRequests.find(r => r.sessionId === existing.id);
    return { request, session:existing };
  }
  const prior = tx.state.trips.filter(t => t.vehicleId === v.id && t.endedAt !== null)
    .sort((a,b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  const lastDestination = prior && tx.state.holds.find(h => h.id === prior.holdId);
  if (tx.actor.role === 'STUDENT' && (!prior || prior.userId !== tx.actor.id || prior.endedAt === null
    || tx.now - prior.endedAt > RECENT_RETURN || !lastDestination || lastDestination.slotId !== v.slotId))
    fail(403, 'FORBIDDEN', 'Chỉ người trả xe trong 30 phút qua tại chỗ đỗ hiện tại hoặc Operator có thể yêu cầu sạc.');
  if (!v.hubId || !v.slotId || v.allocationOwner || v.healthStatus !== 'OK' || !fresh(v, tx.now) || v.batteryPercent === null
    || !freshHub(tx.state, v.hubId, tx.now) || !tx.state.slots.some(s => s.id === v.slotId && s.vehicleId === v.id))
    fail(409, 'VEHICLE_UNAVAILABLE', 'Xe cần đỗ hợp lệ và có dữ liệu pin hiện hành trước khi sạc.');
  const targetPercent = input.target === undefined ? 80 : number(input, 'target');
  if (targetPercent > 100 || targetPercent <= v.batteryPercent) fail(400, 'INVALID_CHARGE_TARGET', 'Mức pin mục tiêu phải cao hơn hiện tại và tối đa 100%.');
  const requestedPointId = typeof input.chargingPointId === 'string' ? input.chargingPointId : undefined;
  const hubId = v.hubId;
  const hub = entity(tx.state.hubs, hubId, 'Hub');
  const points = tx.state.points.filter(p => p.hubId === hubId && p.connectorType === v.connectorType);
  if (!points.length || requestedPointId && !points.some(p => p.id === requestedPointId))
    fail(409, 'POINT_INCOMPATIBLE', 'Cổng không tương thích với xe hoặc không ở Hub này.');
  const plugged = points.find(p => p.pluggedVehicleId === v.id);
  if (requestedPointId && plugged && plugged.id !== requestedPointId)
    fail(409,'POINT_MISMATCH','Xe đang cắm ở cổng khác. Chọn cổng đó hoặc rút đầu cắm trước.');
  const powerKW = Math.min(hub.powerLimitKW, (plugged ?? points.find(p => !requestedPointId || p.id === requestedPointId))?.ratedKW ?? 2);
  const endAt = tx.now + chargeEnergyAndDuration(v.capacityKWh, v.batteryPercent, targetPercent, powerKW).durationMinutes * MINUTE;
  const userId = tx.actor.id;
  const s = blankSession(tx, {
    hubId, vehicleId:v.id, userId, private:false, requestedPointId, startAt:tx.now, endAt, powerKW,
    currentPercent:v.batteryPercent, targetPercent, neededAt:input.neededAt === undefined ? undefined : instant(input,'neededAt'),
  });
  tx.state.sessions.push(s);
  const request = { id:tx.id('charge_request'), userId, vehicleId:v.id, sessionId:s.id, createdAt:tx.now };
  tx.state.chargingRequests.push(request);
  tryStart(tx, s);
  return { request, session:s };
}

function tryStart(tx: Tx, s: Session): void {
  if ((s.status !== 'Waiting' && s.status !== 'Scheduled') || s.startAt > tx.now || !freshHub(tx.state, s.hubId, tx.now)) return;
  const booked = s.private ? tx.state.bookings.find(b => b.id === s.bookingId) : undefined;
  if (s.private && booked?.status !== 'InUse') return;
  const v = s.private ? undefined : entity(tx.state.vehicles, s.vehicleId, 'xe dùng chung');
  if (v && (v.allocationOwner !== null || v.healthStatus !== 'OK' || v.hubId !== s.hubId
    || !tx.state.slots.some(slot => slot.id === v.slotId && slot.vehicleId === v.id))) return;
  const points = tx.state.points.filter(p => compatiblePoint(tx.state, p, s)
    && (!s.requestedPointId || s.requestedPointId === p.id) && (!s.pointId || s.pointId === p.id)
    && !p.powered && (!p.pluggedVehicleId || p.pluggedVehicleId === s.vehicleId));
  for (const p of points) {
    const powerKW = Math.min(p.ratedKW, s.powerKW);
    const endAt = tx.now + chargeEnergyAndDuration(capacity(tx.state, s), s.currentPercent, s.targetPercent, powerKW).durationMinutes * MINUTE;
    const a = { sessionId:s.id, pointId:p.id, startAt:tx.now, endAt, powerKW, priority:0 };
    if (!canScheduleCharge(tx.state, a)) continue;
    beginCharging(tx, s, p, a);
    return;
  }
}

export function applyChargingAck(tx: Tx, command: Command, success: boolean): void {
  if (command.status !== 'Pending' || command.type === 'UNLOCK') return;
  const s = tx.state.sessions.find(s => s.id === command.subjectId);
  if (!s || s.commandId !== command.id || s.pointId !== command.resourceId) {
    command.status = 'Failed';
    return;
  }
  const point = entity(tx.state.points, command.resourceId, 'cổng sạc');
  if (command.type === 'CHARGE_START' && s.status === 'Starting') {
    if (!success) {
      stopCharging(tx, s, 'Failed');
      return;
    }
    if (point.blocked || (point.pluggedVehicleId && point.pluggedVehicleId !== s.vehicleId)
      || tx.state.points.some(other => other.id !== point.id && other.pluggedVehicleId === s.vehicleId)) {
      stopCharging(tx, s, 'Failed');
      return;
    }
    point.powered = true;
    point.pluggedVehicleId = s.vehicleId;
    s.status = 'Charging';
    s.startedAt = tx.now;
    if (!s.private) applyVehicleChargingState(tx, s.vehicleId, true);
    tx.notify(s.userId, 'Thiết bị xác nhận đã bắt đầu sạc.');
  } else if (command.type === 'CHARGE_STOP' && s.status === 'StopPending') {
    if (!success) {
      command.nextProbeAt = tx.now + 5_000;
      return;
    }
    point.powered = false;
    s.status = s.desiredStop ?? 'Stopped';
    if (!s.private) applyVehicleChargingState(tx, s.vehicleId, false);
    tx.notify(s.userId, 'Thiết bị xác nhận đã ngắt điện. Rút đầu cắm trước khi dùng lại cổng.');
  } else {
    command.status = 'Failed';
    return;
  }
  command.status = 'Confirmed';
  s.version++;
  s.updatedAt = tx.now;
  tx.log('CHARGE_ACK', s.id, s.status);
}

function currentPointSession(state: State, pointId: string): Session | undefined {
  return state.sessions.find(s => s.pointId === pointId && activeSession(s));
}

function usablePoint(state: State, point: Point, now: number): boolean {
  return !point.blocked && !point.powered && !point.pluggedVehicleId && !currentPointSession(state, point.id)
    && !state.sessions.some(session => session.pointId === point.id && session.status === 'Scheduled' && session.startAt <= now && now < session.endAt);
}

export function hubSummary(state: State, hubId: string, now: number) {
  const hub = entity(state.hubs, hubId, 'Hub');
  const stale = !freshHub(state, hubId, now);
  const slots = state.slots.filter(s => s.hubId === hubId);
  const points = state.points.filter(p => p.hubId === hubId);
  const occupiedSlots = slots.filter(s => s.vehicleId !== null).length;
  const openAlerts = state.alerts.filter(a => a.hubId === hubId && a.status === 'Open').length;
  return {
    ...hub, stale, occupiedSlots, totalSlots:slots.length, openAlerts,
    parkingOccupancyPct:stale || !slots.length ? null : occupiedSlots * 100 / slots.length,
    availableSlots:stale || parkingBlocked(state,hubId) ? 0 : slots.filter(s => s.type === 'SHARED' && canUseSlot(state,s,now,Infinity)).length,
    availableVehicles:stale ? 0 : state.vehicles.filter(v => v.hubId === hubId && v.mobilityStatus === 'Available' && v.healthStatus === 'OK'
      && !v.allocationOwner && fresh(v,now) && (v.batteryPercent ?? 0) >= 20
      && !state.sessions.some(s => s.vehicleId === v.id && openSession(s)) && !points.some(p => p.pluggedVehicleId === v.id)).length,
    availablePoints:stale ? 0 : points.filter(p => usablePoint(state,p,now)).length,
    powerInUseKW:state.sessions.filter(s => s.hubId === hubId && activeSession(s)).reduce((kw,s) => kw + s.powerKW,0),
    points:points.map(p => {
      const current = currentPointSession(state,p.id);
      return { ...p, activeSessionId:current?.id ?? null,
        occupancy:p.pluggedVehicleId && !p.powered && !current ? 'NeedsClear' : p.pluggedVehicleId || p.powered || current ? 'Occupied' : 'Empty' };
    }),
  };
}

function reconcileAlert(tx: Tx, hubId: string, type: 'PARKING'|'CHARGING', open: boolean) {
  const current = tx.state.alerts.find(a => a.hubId === hubId && a.type === type && a.status === 'Open');
  if (open && !current) {
    const alert = { id:tx.id('alert'), hubId, type, status:'Open' as const, openedAt:tx.now, acknowledgedAt:null,resolvedAt:null,version:1 };
    tx.state.alerts.push(alert);
    tx.log('ALERT_OPENED', alert.id, type);
  } else if (!open && current) {
    current.status = 'Resolved';
    current.resolvedAt = tx.now;
    current.version++;
    tx.log('ALERT_RESOLVED', current.id, type);
  }
}

function refreshAlerts(tx: Tx) {
  for (const hub of tx.state.hubs) {
    if (!freshHub(tx.state,hub.id,tx.now)) continue;
    reconcileAlert(tx,hub.id,'PARKING',parkingBlocked(tx.state,hub.id));
    const points = tx.state.points.filter(p => p.hubId === hub.id);
    reconcileAlert(tx,hub.id,'CHARGING',points.length > 0 && !points.some(p => usablePoint(tx.state,p,tx.now)));
  }
}

export function m2Tick(tx: Tx): void {
  for (const booking of tx.state.bookings) {
    if (booking.status !== 'Scheduled' || booking.endAt > tx.now) continue;
    const hold = entity(tx.state.holds,booking.holdId,'lượt giữ chỗ');
    if (hold.status === 'Held') hold.status = 'Released';
    booking.status = 'Completed';
    booking.version++;
    tx.log('PARKING_EXPIRED', booking.id, 'Hết lịch đỗ chưa sử dụng.');
  }
  for (const s of tx.state.sessions) {
    if (s.status === 'Charging' && s.updatedAt < tx.now) {
      const dtHours = (tx.now - s.updatedAt) / (60 * MINUTE);
      const kWh = capacity(tx.state,s);
      s.currentPercent = Math.min(s.targetPercent, s.currentPercent + 100 * dtHours * s.powerKW / kWh);
      s.updatedAt = tx.now;
      if (!s.private && !tx.state.demo.pausedHubs.includes(s.hubId)) {
        const v = entity(tx.state.vehicles,s.vehicleId,'xe dùng chung');
        v.batteryPercent = s.currentPercent;
        v.observedAt = tx.now;
        v.sequence++;
      }
      if (s.currentPercent + 1e-9 >= s.targetPercent) stopCharging(tx,s,'Completed');
      else if (tx.now >= s.endAt) stopCharging(tx,s,'Stopped');
    } else if (s.status === 'Scheduled' && tx.now >= s.endAt) {
      stopCharging(tx,s,'Cancelled');
      tx.notify(s.userId,'Lịch sạc đã hết trước khi có thể bắt đầu.');
    }
  }
  const ordered = tx.state.sessions.filter(s => s.status === 'Waiting' || s.status === 'Scheduled')
    .sort((a,b) => Number(b.status === 'Scheduled') - Number(a.status === 'Scheduled') || a.startAt - b.startAt || a.waitingSince - b.waitingSince || a.id.localeCompare(b.id));
  for (const s of ordered) tryStart(tx,s);
  refreshAlerts(tx);
}

function setParkingFixture(tx: Tx, input: Input) {
  const hubId = requiredString(input,'hubId');
  entity(tx.state.hubs,hubId,'Hub');
  const occupied = number(input,'occupied');
  const slots = tx.state.slots.filter(s => s.hubId === hubId);
  if (!Number.isInteger(occupied) || occupied < 0 || occupied > slots.length)
    fail(400,'INVALID_OCCUPANCY','Số chỗ vật lý phải là số nguyên trong sức chứa Hub.');
  const fixtureId = (slot: Slot) => 'DEMO_OCCUPANCY-' + slot.id;
  const occupiedNow = slots.filter(s => s.vehicleId !== null).length;
  const delta = occupied - occupiedNow;
  if (delta > 0) {
    const eligible = slots.filter(s => s.vehicleId === null && !s.blocked
      && !tx.state.holds.some(h => h.slotId === s.id && activeHold(h)));
    if (eligible.length < delta)
      fail(409,'OCCUPANCY_FIXTURE_CONFLICT','Không đủ chỗ trống để tạo tải mẫu mà vẫn bảo vệ chỗ đang giữ.');
    for (const s of eligible.slice(0,delta)) {
      const id = fixtureId(s);
      if (tx.state.privateVehicles.some(v=>v.id===id) || tx.state.vehicles.some(v=>v.id===id))
        fail(409,'OCCUPANCY_FIXTURE_CONFLICT','ID xe giả lập đang được dùng.');
      if (s.type === 'PRIVATE') {
        tx.state.privateVehicles.push({id,userId:'DEMO_OCCUPANCY',plate:'Xe giả lập chỗ đỗ',capacityKWh:4,connectorType:'TYPE2'});
      } else {
        tx.state.vehicles.push({id,type:'Xe giả lập chỗ đỗ',hubId,slotId:s.id,batteryPercent:null,observedAt:null,sequence:0,
          healthStatus:'Maintenance',mobilityStatus:'NeedsCharge',allocationOwner:null,connectorType:'TYPE2',capacityKWh:4,version:1});
      }
      s.vehicleId = id;
    }
  } else if (delta < 0) {
    const removable = slots.filter(s => s.vehicleId === fixtureId(s) && !s.blocked
      && !tx.state.points.some(p => p.pluggedVehicleId === s.vehicleId)
      && !tx.state.sessions.some(ch => ch.vehicleId === s.vehicleId)
      && !tx.state.orders.some(o => o.items.some(i => i.vehicleId === s.vehicleId))
      && !tx.state.reservations.some(r => r.vehicleId === s.vehicleId)
      && !tx.state.trips.some(t => t.vehicleId === s.vehicleId)
      && !tx.state.bookings.some(b => b.vehicleId === s.vehicleId)
      && !tx.state.incidents.some(i => i.resourceType === 'vehicle' && i.resourceId === s.vehicleId));
    if (removable.length < -delta)
      fail(409,'OCCUPANCY_FIXTURE_CONFLICT','Không giảm thêm được vì các xe còn lại thuộc dữ liệu vận hành.');
    const ids = new Set(removable.slice(0,-delta).map(fixtureId));
    for (const s of removable.slice(0,-delta)) s.vehicleId = null;
    tx.state.vehicles = tx.state.vehicles.filter(v => !ids.has(v.id));
    tx.state.privateVehicles = tx.state.privateVehicles.filter(v => !ids.has(v.id));
  }
  if (delta !== 0) tx.log('DEMO_PARKING_OCCUPANCY',hubId,'Mô phỏng ' + occupied + '/' + slots.length + ' chỗ đỗ có xe.');
  refreshAlerts(tx);
  return { hubId, occupiedSlots:occupied, totalSlots:slots.length };
}

export function simulatePhysicalEvent(tx: Tx, input: Input) {
  if (tx.actor.role !== 'OPERATOR' && tx.actor.role !== 'SYSTEM') fail(403,'FORBIDDEN','Chỉ Operator được dùng thiết bị giả lập.');
  const kind = requiredString(input,'kind');
  if (kind === 'parking-fixture') return setParkingFixture(tx,input);
  if (kind === 'private-arrive' || kind === 'private-depart') {
    const b = entity(tx.state.bookings,requiredString(input,'bookingId'),'lượt đặt chỗ đỗ');
    checkVersion(input,b);
    const result = kind === 'private-arrive' ? arriveParking(tx,b) : departParking(tx,b);
    refreshAlerts(tx);
    return result;
  }
  if (kind !== 'plug') return fail(400,'INVALID_INPUT','Loại sự kiện vật lý không được hỗ trợ.');
  const p = entity(tx.state.points,requiredString(input,'pointId'),'cổng sạc');
  const vehicleId = input.vehicleId === null ? null : requiredString(input,'vehicleId');
  if (p.pluggedVehicleId === vehicleId) return p;
  if (p.powered || currentPointSession(tx.state,p.id)) fail(409,'DEVICE_PENDING','Cần xác nhận ngắt điện trước khi đổi cắm/rút.');
  if (vehicleId) {
    if (p.blocked || p.pluggedVehicleId || tx.state.points.some(other => other.pluggedVehicleId === vehicleId))
      fail(409,'POINT_UNAVAILABLE','Cổng hoặc xe đang bị chiếm dụng.');
    const parked = tx.state.slots.some(s => s.hubId === p.hubId && s.vehicleId === vehicleId);
    const v = tx.state.vehicles.find(v => v.id === vehicleId) ?? tx.state.privateVehicles.find(v => v.id === vehicleId);
    if (!parked || !v || v.connectorType !== p.connectorType) fail(409,'POINT_INCOMPATIBLE','Xe phải đỗ ở Hub và tương thích với cổng.');
  }
  p.pluggedVehicleId = vehicleId;
  tx.log(vehicleId ? 'DEVICE_PLUGGED' : 'DEVICE_CLEARED',p.id,vehicleId ?? 'Cổng đã được rút đầu cắm.');
  refreshAlerts(tx);
  return p;
}

function createIncident(tx: Tx, input: Input) {
  const resourceType = requiredString(input,'resourceType');
  if (resourceType !== 'vehicle' && resourceType !== 'point' && resourceType !== 'slot') return fail(400,'INVALID_INPUT','Loại tài nguyên không hợp lệ.');
  const resourceId = requiredString(input,'resourceId');
  const description = requiredString(input,'description');
  if (description.length > 1000) fail(400,'INVALID_INPUT','Giới hạn mô tả là 1000 ký tự.');
  if (tx.actor.role === 'STUDENT') {
    const trip = entity(tx.state.trips,requiredString(input,'tripId'),'chuyến đi');
    owned(tx,trip.userId);
    if (resourceType !== 'vehicle' || resourceId !== trip.vehicleId) fail(403,'FORBIDDEN','Chỉ báo sự cố xe thuộc chuyến đi của bạn.');
  }
  if (resourceType === 'vehicle') entity(tx.state.vehicles,resourceId,'xe dùng chung');
  if (resourceType === 'point') entity(tx.state.points,resourceId,'cổng sạc');
  if (resourceType === 'slot') entity(tx.state.slots,resourceId,'chỗ đỗ');
  const incident: Incident = { id:tx.id('incident'), resourceType, resourceId, description, userId:tx.actor.id,
    status:'Reported' as const, impacts:[], ticketId:tx.id('maintenance_ticket'), version:1 };
  tx.state.incidents.push(incident);
  tx.log('INCIDENT_REPORTED',incident.id,description);
  return incident;
}

function isolatePoint(tx: Tx, pointId: string): string[] {
  const p = entity(tx.state.points,pointId,'cổng sạc');
  p.blocked = true;
  const impacts:string[] = [];
  for (const s of tx.state.sessions.filter(s => s.pointId === p.id && reservesPoint(s))) {
    if (activeSession(s)) {
      stopCharging(tx,s,'Failed');
      impacts.push(s.id + ': chờ xác nhận ngắt điện.');
      continue;
    }
    const requested = s.requestedPointId;
    s.requestedPointId = null;
    const alternate = tx.state.points.find(point => canScheduleCharge(tx.state,{
      sessionId:s.id, pointId:point.id, startAt:s.startAt, endAt:s.endAt, powerKW:s.powerKW, priority:0,
    }));
    if (alternate) {
      s.pointId = alternate.id;
      s.version++;
      tx.notify(s.userId,'Lịch sạc được chuyển cổng do sự cố thiết bị.');
      impacts.push(s.id + ': chuyển sang ' + alternate.id);
    } else {
      s.requestedPointId = requested;
      stopCharging(tx,s,'Cancelled');
      tx.notify(s.userId,'Lịch sạc bị hủy do sự cố và không còn cổng thay thế.');
      impacts.push(s.id + ': hủy lịch.');
    }
  }
  return impacts;
}

function isolateSlot(tx: Tx, slotId: string): string[] {
  const slot = entity(tx.state.slots,slotId,'chỗ đỗ');
  slot.blocked = true;
  const impacts: string[] = [];
  for (const hold of tx.state.holds.filter(h => h.slotId === slot.id && h.status === 'Held')) {
    const booking = tx.state.bookings.find(b => b.holdId === hold.id);
    const replacement = tx.state.slots.find(s => s.hubId === slot.hubId && s.type === slot.type
      && canUseSlot(tx.state,s,Math.max(tx.now,hold.startAt),hold.endAt ?? Infinity,hold.id));
    if (replacement) {
      hold.slotId = replacement.id;
      if (booking) {
        booking.slotId = replacement.id;
        booking.version++;
        tx.notify(booking.userId,'Lịch đỗ được chuyển sang vị trí khác do sự cố.');
      }
      impacts.push(hold.id + ': chuyển sang ' + replacement.id);
    } else {
      if (booking) {
        booking.serviceStatus = 'Delayed';
        booking.guarantee = 'NotGuaranteed';
        booking.version++;
        tx.notify(booking.userId,'Chỗ đỗ bị cô lập và chưa có vị trí thay thế.');
      }
      if (hold.ownerType === 'REDISTRIBUTION_ITEM') {
        const item = tx.state.orders.flatMap(o => o.items).find(i => i.id === hold.ownerId);
        if (item) impacts.push(...applyIncidentImpact(tx,item.vehicleId));
      }
      impacts.push(hold.id + ': giữ quyền đến khi có phương án thay thế.');
    }
  }
  return impacts;
}

function isolateIncident(tx: Tx, input: Input) {
  const row = entity(tx.state.incidents,requiredString(input,'id'),'sự cố');
  if (row.status === 'Isolated') return row;
  checkVersion(input,row);
  if (row.status !== 'Reported') fail(409,'INVALID_TRANSITION','Sự cố đã được xử lý.');
  if (row.resourceType === 'point') row.impacts = isolatePoint(tx,row.resourceId);
  else if (row.resourceType === 'slot') row.impacts = isolateSlot(tx,row.resourceId);
  else {
    applyVehicleHealth(tx,row.resourceId,'Maintenance');
    row.impacts = [...applyReservationIncident(tx,row.resourceId), ...applyIncidentImpact(tx,row.resourceId)];
    for (const s of tx.state.sessions.filter(s => s.vehicleId === row.resourceId && openSession(s))) {
      stopCharging(tx,s,'Failed');
      row.impacts.push(s.id + ': yêu cầu dừng hoặc hủy do sự cố xe.');
    }
  }
  row.status = 'Isolated';
  row.version++;
  tx.log('INCIDENT_ISOLATED',row.id,row.impacts.join(', ') || 'Cô lập tài nguyên.');
  refreshAlerts(tx);
  return row;
}

function restoreIncident(tx: Tx, input: Input) {
  const row = entity(tx.state.incidents,requiredString(input,'id'),'sự cố');
  if (row.status === 'Resolved') return row;
  checkVersion(input,row);
  if (row.status !== 'Isolated') fail(409,'INVALID_TRANSITION','Cô lập sự cố trước khi khôi phục.');
  const resolution = requiredString(input,'resolution');
  if (tx.state.incidents.some(i => i.id !== row.id && i.resourceId === row.resourceId && i.resourceType === row.resourceType && i.status === 'Isolated'))
    fail(409,'INCIDENT_ACTIVE','Tài nguyên còn sự cố khác đang cô lập.');
  if (row.resourceType === 'point') {
    const p = entity(tx.state.points,row.resourceId,'cổng sạc');
    if (p.powered || currentPointSession(tx.state,p.id)) fail(409,'DEVICE_PENDING','Chưa xác nhận cổng đã ngắt điện.');
    p.blocked = false;
  } else if (row.resourceType === 'slot') {
    entity(tx.state.slots,row.resourceId,'chỗ đỗ').blocked = false;
  } else {
    const v = entity(tx.state.vehicles,row.resourceId,'xe dùng chung');
    if (v.mobilityStatus === 'UnlockPending' || tx.state.sessions.some(s => s.vehicleId === v.id && activeSession(s)))
      fail(409,'DEVICE_PENDING','Còn lệnh thiết bị chưa được xác nhận.');
    applyVehicleHealth(tx,row.resourceId,'OK');
  }
  row.status = 'Resolved';
  row.version++;
  tx.log('INCIDENT_RESOLVED',row.id,resolution);
  refreshAlerts(tx);
  return row;
}

export function registerM2(add: AddRoute): void {
  add('GET','/me/private-vehicles','STUDENT',tx => tx.state.privateVehicles.filter(v => v.userId === tx.actor.id));
  add('GET','/me/parking-bookings','STUDENT',tx => tx.state.bookings.filter(b => b.userId === tx.actor.id));
  add('POST','/parking/preview','STUDENT',(tx,input) => {
    const { entries,costVnd } = parkingPreview(tx,input);
    return { entries,costVnd };
  },{ readOnly:true });
  add('POST','/parking/bookings','STUDENT',confirmParking);
  add('POST','/parking/bookings/:id/arrive','STUDENT',(tx,input) => {
    const row = entity(tx.state.bookings,requiredString(input,'id'),'lượt đặt chỗ đỗ');
    owned(tx,row.userId);
    checkVersion(input,row);
    return arriveParking(tx,row);
  });
  add('POST','/parking/bookings/:id/depart','STUDENT',(tx,input) => {
    const row = entity(tx.state.bookings,requiredString(input,'id'),'lượt đặt chỗ đỗ');
    owned(tx,row.userId);
    checkVersion(input,row);
    return departParking(tx,row);
  });
  add('POST','/charging/preview','STUDENT',(tx,input) => chargingPreview(tx,input).options,{ readOnly:true });
  add('POST','/charging/bookings','STUDENT',bookCharging);
  add('GET','/me/charging-sessions','STUDENT',tx => tx.state.sessions.filter(s => s.userId === tx.actor.id));
  add('POST','/charging/requests','ANY',stageSharedCharging);
  add('POST','/charging/sessions/:id/stop','ANY',(tx,input) => {
    const s = entity(tx.state.sessions,requiredString(input,'id'),'phiên sạc');
    owned(tx,s.userId);
    checkVersion(input,s);
    return stopCharging(tx,s,'Stopped');
  });
  add('GET','/operator/overview','OPERATOR',(tx,input) => {
    const hubs = tx.state.hubs.filter(h => !input.hubId || h.id === input.hubId).map(h => ({
      ...hubSummary(tx.state,h.id,tx.now),slots:tx.state.slots.filter(slot => slot.hubId===h.id),
    }));
    const totals = { hubs:hubs.length, availableVehicles:0, availableSlots:0, availablePoints:0, occupiedSlots:0, totalSlots:0, powerInUseKW:0, openAlerts:0 };
    for (const h of hubs) {
      for (const key of ['availableVehicles','availableSlots','availablePoints','occupiedSlots','totalSlots','powerInUseKW','openAlerts'] as const)
        totals[key] += h[key];
    }
    return { hubs,totals };
  });
  add('GET','/operator/alerts','OPERATOR',(tx,input) => tx.state.alerts.filter(a => (!input.hubId || a.hubId === input.hubId)
    && (!input.status || a.status === input.status)));
  add('POST','/operator/alerts/:id/acknowledge','OPERATOR',(tx,input) => {
    const alert = entity(tx.state.alerts,requiredString(input,'id'),'cảnh báo');
    checkVersion(input,alert);
    if (alert.status !== 'Open') fail(409,'INVALID_TRANSITION','Cảnh báo đã đóng.');
    if (alert.acknowledgedAt === null) {
      alert.acknowledgedAt = tx.now;
      alert.version++;
      tx.log('ALERT_ACKNOWLEDGED',alert.id,'Đã xem, cảnh báo còn hiệu lực.');
    }
    return alert;
  });
  add('POST','/incidents','ANY',createIncident);
  add('GET','/operator/incidents','OPERATOR',tx => tx.state.incidents);
  add('POST','/operator/incidents/:id/isolate','OPERATOR',isolateIncident);
  add('POST','/operator/incidents/:id/restore','OPERATOR',restoreIncident);
}
