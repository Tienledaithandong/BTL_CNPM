import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';

import { allocateVehicle, confirmVehicleArrival, markVehicleInTransit, releaseVehicleHold } from './m1.js';
import { applyChargingAssignments, arriveDestination, canScheduleCharge, fitsPowerWindow, releaseDestination, reserveDestination } from './m2.js';
import {
  checkVersion, entity, fail, fresh, number, requiredString,
  type AddRoute, type ChargingPlan, type Input, type Item, type Order, type PlanAssignment, type Run, type Scenario, type ScenarioConfig,
  type Session, type State, type Tx,
} from './types.js';

const MINUTE = 60_000;
const TICK = 5 * MINUTE;
const DAY = 24 * 60 * MINUTE;
const VIETNAM_OFFSET = 7 * 60 * MINUTE;
const ENGINE_VERSION = '2';

export function chargingPriority(battery: number, neededAt: number | null, now: number) {
  const hours = neededAt === null ? null : Math.max(1 / 60, (neededAt - now) / (60 * MINUTE));
  return (100 - battery) + (hours === null ? 0 : 10 / hours);
}

interface SimHub { id: string; power: number }
interface SimSlot { id: string; hubId: string; kind: 'SHARED' | 'PRIVATE'; occupiedBy: string | null; blocked: boolean }
interface SimPort { id: string; hubId: string; kw: number; connector: string; blocked: boolean }
interface SimVehicle { id: string; hubId: string; battery: number; slotId: string; available: boolean }
interface SimCommitment { id: string; hubId: string; slotId?: string; portId?: string; start: number; end: number | null; kw?: number }
interface TripDemand { id: string; at: number; from: string; to: string }
interface ChargeDemand { id: string; at: number; hubId: string; kwh: number; connector: string; battery: number; neededAt: number | null }

export interface SimulationNetwork {
  capturedAt: number;
  hubs: SimHub[];
  slots: SimSlot[];
  ports: SimPort[];
  vehicles: SimVehicle[];
  commitments: SimCommitment[];
}

export interface SimulationConfig {
  name: string;
  hubIds: string[];
  hours: number;
  tripChangePct: number;
  chargingChangePct: number;
  unavailablePortPct: number;
  blockedSlots: number;
  startAt?: number;
  blockedSlotsByHub?: Record<string, number>;
  concentrationPct?: number;
}

interface Demands { trips: TripDemand[]; charges: ChargeDemand[] }
interface SimMetrics {
  servedTrips: number;
  rejectedTrips: number;
  peakParkingOccupancy: number | null;
  waitingChargingMinutes: number;
  meanChargingWait: number | null;
  waitingChargingCount: number;
  energyDeliveredKWh: number;
  affectedCount: number;
}
interface SimOutcome {
  metrics: SimMetrics;
  rejectedByReason: { noVehicle: number; noSlot: number };
  affectedIds: string[];
  shortages: Record<string, { vehicles: number; slots: number; charging: number }>;
}
interface ChargeAlternative {
  requestId: string;
  pointId: string;
  slotId: string;
  startAt: number;
  endAt: number;
  powerKW: number;
  energyKWh: number;
}
interface SimResult {
  outcome: SimOutcome;
  initialSlots: SimSlot[];
  alternatives: Map<string, ChargeAlternative>;
}
const lexical = <T extends { id: string }>(left: T, right: T) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
const byTime = <T extends { id: string; at: number }>(left: T, right: T) => left.at - right.at || lexical(left, right);
const overlaps = (start: number, end: number, reservedStart: number, reservedEnd: number | null) =>
  start < (reservedEnd ?? Number.POSITIVE_INFINITY) && reservedStart < end;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function seeded(seed: string, id: string) {
  return createHash('sha256').update(JSON.stringify([seed, id])).digest().readUInt32BE() / 2 ** 32;
}

function makeDemands(network: SimulationNetwork, startAt: number, endAt: number, seed: string): Demands {
  const hubs = [...network.hubs].sort(lexical);
  const trips: TripDemand[] = [];
  const charges: ChargeDemand[] = [];
  for (let tick = 0, at = startAt; at < endAt; tick++, at += TICK) {
    for (const [index, hub] of hubs.entries()) {
      const id = hub.id + ':' + tick;
      if (seeded(seed, id + ':trip') < 0.34) {
        const offset = hubs.length === 1 ? 0 : 1 + Math.floor(seeded(seed, id + ':to') * (hubs.length - 1));
        trips.push({ id: 'TRIP:' + id, at, from: hub.id, to: hubs[(index + offset) % hubs.length].id });
      }
      if (seeded(seed, id + ':charge') < 0.22) {
        const port = network.ports.filter(value => value.hubId === hub.id).sort(lexical)[0];
        charges.push({ id: 'CHARGE:' + id, at, hubId: hub.id, kwh: 1 + seeded(seed, id + ':energy') * 2,
          connector: port?.connector ?? 'Type2', battery: 15 + seeded(seed, id + ':battery') * 50, neededAt: at + 90 * MINUTE });
      }
    }
  }
  return { trips, charges };
}

function scaleDemand<T extends { id: string }>(base: T[], percent: number, seed: string): T[] {
  if (percent === 0) return base;
  const order = [...base].sort((a, b) => seeded(seed, a.id) - seeded(seed, b.id) || lexical(a, b));
  const target = Math.max(0, Math.round(base.length * (1 + percent / 100)));
  if (target <= base.length) return order.slice(0, target);
  if (base.length === 0) return [];
  const added = Array.from({ length: target - base.length }, (_, index) => ({
    ...order[index % order.length], id: order[index % order.length].id + ':EXTRA:' + index,
  }));
  return [...base, ...added];
}

function findChargeWindow(hub: SimHub, req: ChargeDemand, ports: SimPort[], slots: SimSlot[],
  commitments: SimCommitment[], startAt: number, limit: number): ChargeAlternative | undefined {
  for (let start = startAt; start < limit; start += TICK) {
    for (const port of ports) {
      if (port.hubId !== hub.id || port.blocked || port.connector !== req.connector) continue;
      const rated = Math.min(port.kw, hub.power);
      for (const powerKW of new Set([rated, Math.min(rated, 1)])) {
        if (powerKW <= 0) continue;
        const end = start + Math.ceil(req.kwh / powerKW * 12) * TICK;
        if (end > limit || commitments.some(item => item.portId === port.id && overlaps(start,end,item.start,item.end)) ||
            !fitsPowerWindow(hub.power,start,end,powerKW,commitments)) continue;
        const slot = slots.find(item => item.hubId === hub.id && item.kind === 'PRIVATE' && !item.blocked &&
          item.occupiedBy === null && !commitments.some(c => c.slotId === item.id && overlaps(start,end,c.start,c.end)));
        if (slot) return {requestId:req.id,pointId:port.id,slotId:slot.id,startAt:start,endAt:end,powerKW,energyKWh:rounded(req.kwh)};
      }
    }
  }
}

function blockCandidates<T extends Pick<SimSlot, 'id' | 'occupiedBy' | 'blocked'>>(slots: T[]): T[] {
  return slots.filter(slot => !slot.blocked).sort((a, b) =>
    Number(a.occupiedBy !== null) - Number(b.occupiedBy !== null) || lexical(a, b));
}

function* simulate(source: SimulationNetwork, startAt: number, horizon: number, demands: Demands, config: SimulationConfig | null): Generator<void,SimResult> {
  const network = structuredClone(source);
  const hubs = [...network.hubs].sort(lexical);
  const vehicles = [...network.vehicles].sort(lexical);
  const slots = [...network.slots].sort(lexical);
  const ports = [...network.ports].sort(lexical);
  const affectedIds = new Set<string>();
  if (config) {
    const candidates = blockCandidates(slots);
    const blocked = config.blockedSlotsByHub
      ? Object.entries(config.blockedSlotsByHub).flatMap(([hubId, count]) => candidates.filter(slot => slot.hubId === hubId).slice(0, count))
      : candidates.slice(0, config.blockedSlots);
    for (const slot of blocked) slot.blocked = true;
    for (const hub of hubs) {
      const healthy = ports.filter(port => port.hubId === hub.id && !port.blocked);
      for (const port of healthy.slice(0, Math.round(healthy.length * config.unavailablePortPct / 100))) port.blocked = true;
    }
    for (const item of network.commitments) {
      const disabledSlot = item.slotId && slots.some(slot => slot.id === item.slotId && slot.blocked)
        && !source.slots.some(slot => slot.id === item.slotId && slot.blocked);
      const disabledPort = item.portId && ports.some(port => port.id === item.portId && port.blocked)
        && !source.ports.some(port => port.id === item.portId && port.blocked);
      if (overlaps(startAt, horizon, item.start, item.end) && (disabledSlot || disabledPort)) affectedIds.add(item.id);
    }
  }
  const initialSlots = slots.map(slot => ({ ...slot }));
  const trips = [...demands.trips].sort(byTime);
  const charges = [...demands.charges].sort(byTime);
  const inbound: { at: number; vehicle: SimVehicle; slot: SimSlot }[] = [];
  const allocated = new Set<string>();
  const queue: ChargeDemand[] = [];
  const active: { demand: ChargeDemand; port: SimPort; slot: SimSlot; remaining: number; endsAt: number }[] = [];
  const shortages = Object.fromEntries(hubs.map(hub => [hub.id, { vehicles: 0, slots: 0, charging: 0 }]));
  const rejectedByReason = { noVehicle: 0, noSlot: 0 };
  let tripIndex = 0;
  let chargeIndex = 0;
  let servedTrips = 0;
  let peakParkingOccupancy: number | null = null;
  let waitingChargingMinutes = 0;
  let energyDeliveredKWh = 0;
  const canUseSlot = (slot: SimSlot, start: number, end: number) =>
    !slot.blocked && slot.occupiedBy === null && !allocated.has(slot.id) &&
    !network.commitments.some(item => item.slotId === slot.id && overlaps(start, end, item.start, item.end));
  for (let now = startAt; now < horizon; now += TICK) {
    yield;
    for (let index = inbound.length - 1; index >= 0; index--) {
      const arrival = inbound[index];
      if (arrival.at > now) continue;
      arrival.slot.occupiedBy = arrival.vehicle.id;
      arrival.vehicle.slotId = arrival.slot.id;
      arrival.vehicle.hubId = arrival.slot.hubId;
      arrival.vehicle.battery = Math.max(0, arrival.vehicle.battery - 5);
      arrival.vehicle.available = true;
      allocated.delete(arrival.slot.id);
      inbound.splice(index, 1);
    }
    for (let index = active.length - 1; index >= 0; index--) {
      const charge = active[index];
      if (charge.remaining > 1e-8) continue;
      charge.slot.occupiedBy = null;
      active.splice(index, 1);
    }
    while (tripIndex < trips.length && trips[tripIndex].at <= now) {
      const demand = trips[tripIndex++];
      const vehicle = vehicles.find(item => item.hubId === demand.from && item.available && item.battery >= 20);
      if (!vehicle) {
        rejectedByReason.noVehicle++;
        if (shortages[demand.from]) shortages[demand.from].vehicles++;
        continue;
      }
      const slot = slots.find(item => item.hubId === demand.to && item.kind === 'SHARED' &&
        canUseSlot(item, now, Math.max(horizon, now + 15 * MINUTE + TICK)));
      if (!slot) {
        rejectedByReason.noSlot++;
        if (shortages[demand.to]) shortages[demand.to].slots++;
        continue;
      }
      const origin = slots.find(item => item.id === vehicle.slotId && item.occupiedBy === vehicle.id);
      if (origin) origin.occupiedBy = null;
      vehicle.available = false;
      allocated.add(slot.id);
      inbound.push({ at: now + 15 * MINUTE, vehicle, slot });
      servedTrips++;
    }
    while (chargeIndex < charges.length && charges[chargeIndex].at <= now) queue.push(charges[chargeIndex++]);
    queue.sort((a, b) => chargingPriority(b.battery, b.neededAt, now) - chargingPriority(a.battery, a.neededAt, now) || byTime(a, b));
    for (let index = 0; index < queue.length;) {
      const request = queue[index];
      const hub = hubs.find(item => item.id === request.hubId);
      if (!hub) { index++; continue; }
      const port = ports.find(item => {
        if (item.hubId !== hub.id || item.blocked || item.connector !== request.connector || item.kw <= 0 ||
            active.some(candidate => candidate.port.id === item.id)) return false;
        const end = now + Math.ceil((request.kwh / item.kw) * 12) * TICK;
        const commitments = network.commitments.filter(c => c.hubId === hub.id &&
          overlaps(now, end, c.start, c.end));
        if (commitments.some(c => c.portId === item.id)) return false;
        const inProgress = active.filter(charge => charge.port.hubId === hub.id)
          .map(charge => ({start:now,end:charge.endsAt,kw:charge.port.kw}));
        return fitsPowerWindow(hub.power,now,end,item.kw,[...commitments,...inProgress]);
      });
      if (!port) { index++; continue; }
      const endsAt = now + Math.ceil((request.kwh / port.kw) * 12) * TICK;
      const slot = slots.find(item => item.hubId === hub.id && item.kind === 'PRIVATE' && canUseSlot(item, now, endsAt));
      if (!slot) { index++; continue; }
      slot.occupiedBy = request.id;
      waitingChargingMinutes += (now - request.at) / MINUTE;
      active.push({ demand: request, port, slot, remaining: request.kwh, endsAt });
      queue.splice(index, 1);
    }
    for (const charge of active) {
      const delivered = Math.min(charge.remaining, charge.port.kw * (Math.min(TICK, horizon - now) / (60 * MINUTE)));
      charge.remaining -= delivered;
      energyDeliveredKWh += delivered;
    }
    for (const hub of hubs) {
      const operational = slots.filter(slot => slot.hubId === hub.id && !slot.blocked);
      if (operational.length > 0) {
        const percentage = operational.filter(slot => slot.occupiedBy !== null).length / operational.length * 100;
        peakParkingOccupancy = Math.max(peakParkingOccupancy ?? 0, percentage);
      }
    }
  }
  for (const request of queue) {
    waitingChargingMinutes += (horizon - request.at) / MINUTE;
    if (shortages[request.hubId]) shortages[request.hubId].charging++;
  }
  const alternatives = new Map<string, ChargeAlternative>();
  if (config) {
    const commitments = [...network.commitments, ...active.map(({demand,port,slot,endsAt}) => ({
      id:demand.id,hubId:port.hubId,portId:port.id,slotId:slot.id,start:horizon,end:endsAt,kw:port.kw,
    })).filter(item => item.end > horizon)];
    const simulatedChargingSlots = new Set(active.map(charge => charge.slot.id));
    const candidateSlots = slots.map(slot => simulatedChargingSlots.has(slot.id) ? {...slot,occupiedBy:null} : slot);
    for (const hub of hubs) {
      const request = queue.find(item => item.hubId === hub.id);
      if (!request) continue;
      yield;
      const choice = findChargeWindow(hub,request,ports,candidateSlots,commitments.filter(item => item.hubId === hub.id),
        horizon,horizon + 360 * MINUTE);
      if (choice) alternatives.set(hub.id,choice);
    }
  }
  return { initialSlots, alternatives, outcome:{ metrics: { servedTrips, rejectedTrips: rejectedByReason.noVehicle + rejectedByReason.noSlot,
    peakParkingOccupancy: peakParkingOccupancy === null ? null : rounded(peakParkingOccupancy),
    waitingChargingMinutes: rounded(waitingChargingMinutes), meanChargingWait: chargeIndex ? rounded(waitingChargingMinutes / chargeIndex) : null,
    waitingChargingCount: queue.length, energyDeliveredKWh: rounded(energyDeliveredKWh), affectedCount: affectedIds.size },
    rejectedByReason, affectedIds: [...affectedIds].sort(), shortages } };
}

function concentrateTrips(trips: TripDemand[], config: SimulationConfig, seed: string) {
  const focus = config.hubIds[0];
  const magnitude = config.concentrationPct ?? 0;
  return trips.map(trip => {
    if (!magnitude || !focus || seeded(seed, trip.id + ':concentration') >= Math.abs(magnitude) / 100) return trip;
    if (magnitude > 0 && trip.from !== focus) return { ...trip, to: focus };
    if (magnitude < 0 && trip.to === focus) {
      const alternatives = config.hubIds.filter(id => id !== focus && id !== trip.from).sort();
      if (alternatives.length) {
        const index = Math.floor(seeded(seed, trip.id + ':alternative') * alternatives.length);
        return { ...trip, to: alternatives[index] };
      }
    }
    return trip;
  });
}

function* whatIf(network: SimulationNetwork, config: SimulationConfig, seed: string, fixture?: Demands) {
  const startAt = config.startAt ?? network.capturedAt;
  const through = startAt + Math.round(config.hours * 60 * MINUTE);
  const demand = fixture ?? makeDemands(network, startAt, through, seed);
  const {outcome:baseline} = yield* simulate(network, startAt, through, demand, null);
  const {outcome:scenario,initialSlots,alternatives} = yield* simulate(network, startAt, through, { trips: concentrateTrips(scaleDemand(demand.trips, config.tripChangePct, seed), config, seed),
    charges: scaleDemand(demand.charges, config.chargingChangePct, seed) }, config);
  const delta: Record<keyof SimMetrics, number | null> = { ...baseline.metrics };
  for (const metric of Object.keys(delta) as (keyof SimMetrics)[]) {
    const left = baseline.metrics[metric];
    const right = scenario.metrics[metric];
    delta[metric] = left === null || right === null ? null : rounded(right - left);
  }
  const recommendations: { hubId: string; operation: string; detail: string; window?: ChargeAlternative }[] = [];
  const room = (hubId: string) => initialSlots.filter(slot => slot.hubId === hubId && slot.kind === 'SHARED' &&
    !slot.blocked && slot.occupiedBy === null && !network.commitments.some(c => c.slotId === slot.id &&
      overlaps(startAt, through, c.start, c.end))).length;
  for (const [hubId, short] of Object.entries(scenario.shortages)) {
    if (short.vehicles > 0) {
      const source = [...network.hubs].sort(lexical).map(hub => ({
        id: hub.id, surplus: Math.max(0, network.vehicles.filter(vehicle => vehicle.hubId === hub.id &&
          vehicle.available && vehicle.battery >= 20).length - 1),
      })).find(hub => hub.id !== hubId && hub.surplus > 0);
      const count = source ? clamp(short.vehicles, 0, Math.min(room(hubId), source.surplus)) : 0;
      recommendations.push({ hubId, operation: count > 0 ? 'Redistribution' : 'NoFeasibleRedistribution', detail: count > 0 ?
        'Xem xét chuyển ' + count + ' xe từ ' + source?.id + ' đến ' + hubId + '. Kiểm tra lại tài nguyên khi xác nhận.' :
        'Thiếu xe. Snapshot không có nguồn dư và chỗ nhận phù hợp.' });
    }
    if (short.slots > 0) {
      const alternative = [...network.hubs].sort(lexical).find(hub => hub.id !== hubId && room(hub.id) > 0);
      recommendations.push({ hubId, operation: alternative ? 'AlternativeHub' : 'NoFeasibleParking', detail: alternative ?
        'Xem xét Hub ' + alternative.id + ' còn chỗ trong snapshot.' : 'Không tìm thấy Hub khác còn chỗ phù hợp trong snapshot.' });
    }
    if (short.charging > 0) {
      const window = alternatives.get(hubId);
      recommendations.push({ hubId, operation:window ? 'ChargingWindow' : 'NoFeasibleCharging', window,
        detail:window ? 'Khung cho một yêu cầu còn chờ đã qua kiểm tra chỗ đỗ, đầu nối và công suất.' :
          'Không tìm được khung đủ chỗ đỗ, cổng tương thích và công suất cho yêu cầu ưu tiên trong 6 giờ sau kỳ mô phỏng.' });
    }
  }
  return { engineVersion: ENGINE_VERSION, baseline, scenario, delta, recommendations, assumptions: {
    tickMinutes: TICK / MINUTE, tripMinutes: 15, tripBatteryDrop: 5, portRounding: 'nearest integer',
    rentDemandRounding: 'nearest integer', blockedSlotSelection: 'free slots first, then by ID within each group',
    concentration: 'changes trip destinations toward or away from the first selected hub',
    operationalScope: 'selected hubs in a captured snapshot', alternativeChargingHorizonHours: 6 } };
}

export function runWhatIf(network: SimulationNetwork, config: SimulationConfig, seed: string, fixture?: Demands) {
  const steps = whatIf(network,config,seed,fixture);
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
}

const ownerType = 'REDISTRIBUTION_ITEM';

function movable(vehicle: State['vehicles'][number], hubId: string, now: number) {
  return vehicle.hubId === hubId && vehicle.slotId !== null && vehicle.healthStatus === 'OK' &&
    vehicle.mobilityStatus === 'Available' && vehicle.allocationOwner === null &&
    fresh(vehicle, now) && (vehicle.batteryPercent ?? 0) >= 20;
}

function deriveOrder(order: Order): void {
  if (order.status === 'Proposed' || order.status === 'Cancelled') return;
  if (order.items.every(item => ['Completed', 'Dropped', 'Cancelled'].includes(item.status))) {
    const succeeded = order.items.filter(item => item.status === 'Completed').length;
    order.status = succeeded === order.items.length ? 'Completed' : succeeded > 0 ? 'PartiallyCompleted' : 'Failed';
  } else if (order.items.every(item => ['Arrived', 'Completed', 'Dropped', 'Cancelled'].includes(item.status))) {
    order.status = 'Arrived';
  } else {
    order.status = order.items.some(item => item.departedAt !== null) ? 'InTransit' : 'Confirmed';
  }
}

function currentOrder(tx: Tx, input: Input) {
  const order = entity(tx.state.orders, requiredString(input, 'id'), 'lệnh điều phối');
  checkVersion(input, order);
  return order;
}

function changedOrder(tx: Tx, order: Order, event: string, detail: string) {
  deriveOrder(order);
  order.version++;
  tx.log(event, order.id, detail);
  return order;
}

function selectItems(input: Input, items: Item[]) {
  if (input.itemIds === undefined) return items.filter(item => item.status === 'Allocated');
  if (!Array.isArray(input.itemIds) || !input.itemIds.length || !input.itemIds.every(id => typeof id === 'string') ||
      new Set(input.itemIds).size !== input.itemIds.length)
    fail(400, 'INVALID_ITEMS', 'Chọn ít nhất một mục điều phối, mỗi mục một lần.');
  return (input.itemIds as string[]).map(id => entity(items, id, 'mục điều phối'));
}

export function applyIncidentImpact(tx: Tx, vehicleId: string): string[] {
  const affected: string[] = [];
  for (const order of tx.state.orders) {
    let changed = false;
    for (const item of order.items) {
      if (item.vehicleId !== vehicleId || (item.status !== 'Allocated' && item.status !== 'InTransit')) continue;
      item.status = 'NeedsOperatorAction';
      affected.push(item.id);
      changed = true;
    }
    if (changed) changedOrder(tx, order, 'REDISTRIBUTION_INCIDENT', 'Cần xử lý xe ' + vehicleId + '. Giữ quyền và chỗ đích.');
  }
  return affected;
}

function registerRedistribution(add: AddRoute): void {
  const base = '/operator/redistributions';
  add('GET', base, 'OPERATOR', tx => [...tx.state.orders].reverse());
  add('POST', base, 'OPERATOR', (tx, input) => {
    const sourceHubId = entity(tx.state.hubs, requiredString(input, 'sourceHubId'), 'Hub nguồn').id;
    const destinationHubId = entity(tx.state.hubs, requiredString(input, 'destinationHubId'), 'Hub đích').id;
    const quantity = number(input, 'quantity');
    if (sourceHubId === destinationHubId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      fail(400, 'INVALID_REQUEST', 'Chọn hai Hub khác nhau và số xe nguyên từ 1 đến 100.');
    const candidates = tx.state.vehicles.filter(vehicle => movable(vehicle, sourceHubId, tx.now)).sort(lexical);
    const order: Order & { candidateVehicleIds: string[] } = {
      id: tx.id('ORDER'), sourceHubId, destinationHubId, quantity, version: 1, status: 'Proposed', items: [],
      candidateVehicleIds: candidates.slice(0, quantity).map(vehicle => vehicle.id),
    };
    tx.state.orders.push(order);
    tx.log('REDISTRIBUTION_PROPOSED', order.id, 'Đề xuất điều phối ' + quantity + ' xe.');
    return order;
  });
  add('POST', base + '/:id/confirm', 'OPERATOR', (tx, input) => {
    const order = currentOrder(tx, input);
    if (order.status !== 'Proposed') fail(409, 'INVALID_TRANSITION', 'Chỉ xác nhận đề xuất chưa được xác nhận.');
    const candidates = tx.state.vehicles.filter(vehicle => movable(vehicle, order.sourceHubId, tx.now)).sort(lexical);
    if (candidates.length < order.quantity) fail(409, 'VEHICLE_UNAVAILABLE', 'Không còn đủ xe có thể điều phối.');
    for (const vehicle of candidates.slice(0, order.quantity)) {
      const itemId = tx.id('ITEM');
      const hold = reserveDestination(tx, order.destinationHubId, ownerType, itemId);
      allocateVehicle(tx, vehicle.id, itemId);
      order.items.push({ id: itemId, vehicleId: vehicle.id, holdId: hold.id, status: 'Allocated', departedAt: null, arrivedAt: null });
    }
    order.status = 'Confirmed';
    return changedOrder(tx, order, 'REDISTRIBUTION_CONFIRMED', 'Đã giữ xe và chỗ đích.');
  });
  add('POST', base + '/:id/start', 'OPERATOR', (tx, input) => {
    const order = currentOrder(tx, input);
    const items = selectItems(input, order.items);
    if (!items.length || items.some(item => item.status !== 'Allocated'))
      fail(409, 'INVALID_TRANSITION', 'Chỉ ghi nhận xuất phát cho mục đã cấp xe và chỗ đích.');
    for (const item of items) {
      markVehicleInTransit(tx, item.vehicleId, item.id);
      item.departedAt = tx.now;
      item.status = 'InTransit';
    }
    return changedOrder(tx, order, 'REDISTRIBUTION_DEPARTED', 'Đã ghi nhận xuất phát cho ' + items.length + ' xe.');
  });
  add('POST', base + '/:id/arrivals', 'OPERATOR', (tx, input) => {
    const order = currentOrder(tx, input);
    const item = entity(order.items, requiredString(input, 'itemId'), 'mục điều phối');
    const hubId = requiredString(input, 'hubId');
    if (item.status !== 'InTransit' || item.departedAt === null)
      fail(409, 'INVALID_TRANSITION', 'Mục điều phối phải đang vận chuyển.');
    if (hubId !== order.destinationHubId) fail(409, 'WRONG_HUB', 'Xe chưa tới đúng Hub đích.');
    const preferred = input.slotId === undefined ? undefined : requiredString(input, 'slotId');
    const slot = arriveDestination(tx, item.holdId, ownerType, item.id, item.vehicleId, preferred);
    confirmVehicleArrival(tx, item.vehicleId, item.id, hubId, slot.id);
    item.arrivedAt = tx.now;
    item.status = 'Arrived';
    return changedOrder(tx, order, 'REDISTRIBUTION_ARRIVED', item.vehicleId + ' đã đến ' + hubId + '.');
  });
  add('POST', base + '/:id/complete', 'OPERATOR', (tx, input) => {
    const order = currentOrder(tx, input);
    const arrived = order.items.filter(item => item.status === 'Arrived');
    if (!arrived.length) fail(409, 'INVALID_TRANSITION', 'Không có mục đã đến để xác nhận hoàn tất.');
    for (const item of arrived) item.status = 'Completed';
    return changedOrder(tx, order, 'REDISTRIBUTION_COMPLETED', 'Đã hoàn tất ' + arrived.length + ' mục đến nơi.');
  });
  add('POST', base + '/:id/cancel', 'OPERATOR', (tx, input) => {
    const order = currentOrder(tx, input);
    if (!['Proposed', 'Confirmed'].includes(order.status) || order.items.some(item => item.departedAt !== null))
      fail(409, 'INVALID_TRANSITION', 'Không hủy toàn lệnh khi có xe đã xuất phát hoặc lệnh đã kết thúc.');
    for (const item of order.items.filter(item => ['Allocated', 'NeedsOperatorAction'].includes(item.status))) {
      releaseDestination(tx, item.holdId, ownerType, item.id);
      releaseVehicleHold(tx, item.vehicleId, item.id);
      item.status = 'Cancelled';
    }
    order.status = 'Cancelled';
    return changedOrder(tx, order, 'REDISTRIBUTION_CANCELLED', 'Đã hủy lệnh trước xuất phát.');
  });
  add('POST', base + '/:id/resolve-item', 'OPERATOR', (tx, input) => {
    const order = currentOrder(tx, input);
    const item = entity(order.items, requiredString(input, 'itemId'), 'mục điều phối');
    if (item.status !== 'NeedsOperatorAction') fail(409, 'INVALID_TRANSITION', 'Mục điều phối không cần xử lý.');
    const action = requiredString(input, 'action');
    if (action === 'resume') {
      const vehicle = entity(tx.state.vehicles, item.vehicleId, 'xe');
      if (vehicle.healthStatus !== 'OK' || !fresh(vehicle, tx.now) ||
          vehicle.allocationOwner?.type !== ownerType || vehicle.allocationOwner.id !== item.id)
        fail(409, 'VEHICLE_UNAVAILABLE', 'Xe chưa sẵn sàng để tiếp tục.');
      const hold = entity(tx.state.holds, item.holdId, 'chỗ đích đã giữ');
      if (hold.status !== 'Held' || hold.ownerId !== item.id || hold.ownerType !== ownerType)
        fail(409, 'INVALID_HOLD', 'Chỗ đích không còn được giữ.');
      item.status = item.departedAt === null ? 'Allocated' : 'InTransit';
    } else if (action === 'drop') {
      if (item.departedAt !== null) fail(409, 'ARRIVAL_REQUIRED', 'Xe đã xuất phát. Hãy xác minh xe đã đến hoặc tiếp tục vận chuyển.');
      releaseDestination(tx, item.holdId, ownerType, item.id);
      releaseVehicleHold(tx, item.vehicleId, item.id);
      item.status = 'Dropped';
    } else fail(400, 'INVALID_INPUT', 'Chọn tiếp tục hoặc loại mục điều phối.');
    return changedOrder(tx, order, 'REDISTRIBUTION_RESOLVED', 'Đã xử lý mục ' + item.id + '.');
  });
}

interface VersionedPlan extends ChargingPlan {
  createdAt?: number;
  candidateVersions?: Record<string, number>;
}
const planMaxAge = 5 * MINUTE;
const schedulerHorizon = 6 * 60 * MINUTE;

function chargingBounds(state: State, session: Session, now: number) {
  if (!session.private) {
    const vehicle = state.vehicles.find(value => value.id === session.vehicleId);
    return vehicle?.hubId === session.hubId && vehicle.healthStatus === 'OK' && vehicle.allocationOwner === null &&
      fresh(vehicle, now) && vehicle.batteryPercent! < session.targetPercent
      ? { connector: vehicle.connectorType, capacity: vehicle.capacityKWh, battery: vehicle.batteryPercent!,
        from: now, to: now + schedulerHorizon }
      : undefined;
  }
  const booking = state.bookings.find(value => value.id === session.bookingId && value.vehicleId === session.vehicleId &&
    value.hubId === session.hubId && ['Scheduled', 'InUse'].includes(value.status) && value.endAt > now);
  const vehicle = state.privateVehicles.find(value => value.id === session.vehicleId);
  return booking && vehicle && session.currentPercent < session.targetPercent
    ? { connector: vehicle.connectorType, capacity: vehicle.capacityKWh, battery: session.currentPercent,
      from: Math.max(now, booking.startAt), to: Math.min(booking.endAt, now + schedulerHorizon) }
    : undefined;
}

function createChargingPlan(tx: Tx, hubId: string, overrides: string[]): VersionedPlan {
  const working = structuredClone(tx.state);
  const hub = entity(working.hubs, hubId, 'Hub');
  const waiting = working.sessions.filter(session => session.hubId === hub.id && session.status === 'Waiting');
  if (overrides.some(id => !waiting.some(session => session.id === id)))
    fail(400, 'INVALID_OVERRIDE', 'Thứ tự ưu tiên chứa yêu cầu không nằm trong hàng chờ của Hub.');
  const ranking = waiting.map(session => {
    const bounds = chargingBounds(working, session, tx.now);
    const priority = chargingPriority(bounds?.battery ?? session.currentPercent, session.neededAt, tx.now);
    return { session, bounds, priority };
  });
  const rank = (sessionId: string) => overrides.indexOf(sessionId) === -1 ? overrides.length : overrides.indexOf(sessionId);
  ranking.sort((a, b) => rank(a.session.id) - rank(b.session.id) || b.priority - a.priority ||
    a.session.waitingSince - b.session.waitingSince || lexical(a.session, b.session));
  const plan: VersionedPlan = { id: tx.id('PLAN'), hubId, version: 1, baseVersion: tx.state.version, status: 'Proposed',
    assignments: [], excluded: [], createdAt: tx.now, candidateVersions: {} };
  for (const { session, bounds, priority } of ranking) {
    if (!bounds) {
      plan.excluded.push({ sessionId: session.id, reason: 'Xe, telemetry hoặc lịch đỗ không đủ điều kiện.' });
      continue;
    }
    const ports = working.points.filter(point => point.hubId === hubId && !point.blocked && point.connectorType === bounds.connector &&
      (point.pluggedVehicleId === null || point.pluggedVehicleId === session.vehicleId) &&
      (session.requestedPointId === null || session.requestedPointId === point.id)).sort(lexical);
    const starts = new Set([bounds.from]);
    for (const existing of working.sessions.filter(value => value.hubId === hubId)) {
      if (existing.endAt > bounds.from && existing.endAt < bounds.to) starts.add(existing.endAt);
    }
    let assignment: PlanAssignment | undefined;
    for (const startAt of [...starts].sort((a, b) => a - b)) {
      for (const point of ports) {
        const powerKW = Math.min(hub.powerLimitKW, point.ratedKW);
        if (!(powerKW > 0)) continue;
        // Cùng dạng với chargeEnergyAndDuration/canScheduleCharge — dùng mức pin của yêu cầu sạc.
        const energy = bounds.capacity * (session.targetPercent - session.currentPercent) / 100;
        const endAt = startAt + Math.ceil(60 * energy / powerKW) * MINUTE;
        if (endAt <= startAt || endAt > bounds.to) continue;
        const candidate = { sessionId: session.id, pointId: point.id, startAt, endAt, powerKW, priority: rounded(priority) };
        if (canScheduleCharge(working, candidate)) { assignment = candidate; break; }
      }
      if (assignment) break;
    }
    if (!assignment) {
      plan.excluded.push({ sessionId: session.id, reason: 'Không có cửa sổ cổng, chỗ đỗ và công suất phù hợp trong 6 giờ.' });
      continue;
    }
    plan.assignments.push(assignment);
    plan.candidateVersions![session.id] = session.version;
    Object.assign(session, { status: 'Scheduled', pointId: assignment.pointId, startAt: assignment.startAt,
      endAt: assignment.endAt, powerKW: assignment.powerKW });
  }
  return plan;
}

function registerChargingPlans(add: AddRoute) {
  const base = '/operator/charging-plans';
  add('GET', base, 'OPERATOR', tx => [...tx.state.plans].reverse());
  add('POST', base + '/preview', 'OPERATOR', (tx, input) => {
    const raw = input.overrides ?? [];
    if (!Array.isArray(raw) || !raw.every(id => typeof id === 'string') || new Set(raw).size !== raw.length)
      fail(400, 'INVALID_OVERRIDE', 'Thứ tự ưu tiên cần là danh sách ID không lặp.');
    const plan = createChargingPlan(tx, requiredString(input, 'hubId'), raw as string[]);
    tx.state.plans.push(plan);
    tx.log('CHARGING_PLAN_PREVIEWED', plan.id, 'Đã tính lịch đề xuất, chưa cấp tài nguyên.');
    return plan;
  });
  add('POST', base + '/:id/apply', 'OPERATOR', (tx, input) => {
    const plan = entity(tx.state.plans, requiredString(input, 'id'), 'kế hoạch sạc') as VersionedPlan;
    checkVersion(input, plan);
    if (plan.status !== 'Proposed' || !plan.assignments.length)
      fail(409, 'INVALID_TRANSITION', 'Kế hoạch không có phân bổ hoặc đã được áp dụng.');
    if (plan.createdAt === undefined || tx.now - plan.createdAt > planMaxAge)
      fail(409, 'PLAN_EXPIRED', 'Kế hoạch đã hết hạn, hãy xem trước lại.');
    // Move an immediate preview to current time while preserving its duration.
    const shift = Math.max(0, tx.now - Math.min(...plan.assignments.map(value => value.startAt)));
    const assignments = plan.assignments.map(value => ({ ...value, startAt: value.startAt + shift, endAt: value.endAt + shift }));
    for (const assignment of assignments) {
      const session = entity(tx.state.sessions, assignment.sessionId, 'yêu cầu sạc');
      const bounds = chargingBounds(tx.state, session, tx.now);
      if (!bounds || session.status !== 'Waiting' || plan.candidateVersions?.[session.id] !== session.version ||
          assignment.startAt < bounds.from || assignment.endAt > bounds.to)
        fail(409, 'PLAN_STALE', 'Yêu cầu hoặc cửa sổ sạc đã thay đổi, hãy xem trước lại.');
      const minutes = Math.ceil(60 * bounds.capacity * (session.targetPercent - session.currentPercent) / 100 / assignment.powerKW);
      if (assignment.endAt - assignment.startAt < minutes * MINUTE)
        fail(409, 'PLAN_STALE', 'Mức pin đã thay đổi. Khung giờ hiện tại không đủ.');
    }
    const sessionIds = applyChargingAssignments(tx, plan.hubId, assignments);
    plan.assignments = assignments;
    plan.status = 'Applied';
    plan.version++;
    tx.log('CHARGING_PLAN_APPLIED', plan.id, 'Đã áp dụng ' + sessionIds.length + ' phân bổ.');
    return { ...plan, sessionIds };
  });
}

function bounded(input: Input, key: string, fallback: number, min: number, max: number, integer = false) {
  const value = input[key] === undefined ? fallback : number(input, key);
  if (value < min || value > max || (integer && !Number.isInteger(value)))
    fail(400, 'INVALID_INPUT', 'Giá trị ' + key + ' nằm ngoài giới hạn.');
  return value;
}

function scenarioTime(input: Input, key: 'startTime' | 'endTime', label: string): string | null | undefined {
  const value = input[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    fail(400, 'INVALID_TIME', label + ' phải có định dạng giờ:phút.');
  return value;
}

function dailyScenarioWindow(now: number, startTime: string | null | undefined, endTime: string | null | undefined, allowNextDay: boolean) {
  const offset = (time: string) => (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * MINUTE;
  const start = startTime ? offset(startTime) : 0;
  const end = endTime ? offset(endTime) : DAY;
  if (start >= end) fail(400, 'INVALID_TIME', 'Giờ kết thúc phải sau giờ bắt đầu.');
  const midnight = Math.floor((now + VIETNAM_OFFSET) / DAY) * DAY - VIETNAM_OFFSET;
  const currentMinute = Math.floor(now / MINUTE) * MINUTE;
  const passed = startTime ? midnight + start < currentMinute : midnight + end <= now;
  if (passed && !allowNextDay)
    fail(400, 'INVALID_TIME', startTime ? 'Giờ bắt đầu phải từ thời điểm hiện tại trở đi.' : 'Giờ kết thúc phải sau thời điểm hiện tại.');
  const day = passed ? midnight + DAY : midnight;
  return { startAt: Math.max(now, day + start), endAt: day + end };
}

function configured(tx: Tx, raw: Input, previous?: ScenarioConfig): ScenarioConfig {
  const { state, now } = tx;
  const ids = raw.hubIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length ||
      !ids.every(id => typeof id === 'string' && state.hubs.some(hub => hub.id === id)))
    fail(400, 'INVALID_HUBS', 'Chọn 1 đến 3 Hub đang tồn tại.');
  const startTime = scenarioTime(raw, 'startTime', 'Giờ bắt đầu');
  const endTime = scenarioTime(raw, 'endTime', 'Giờ kết thúc');
  let durationMinutes: number;
  if (startTime !== undefined || endTime !== undefined) {
    const unchanged = previous !== undefined && previous.startTime === startTime && previous.endTime === endTime;
    const window = dailyScenarioWindow(now, startTime, endTime, unchanged);
    durationMinutes = Math.ceil((window.endAt - window.startAt) / MINUTE);
  } else {
    durationMinutes = bounded(raw, 'durationMinutes', 120, 5, 360, true);
    if (durationMinutes % 5 !== 0) fail(400, 'INVALID_DURATION', 'Thời lượng phải chia hết cho 5 phút.');
  }
  const slots = state.slots.filter(slot => ids.includes(slot.hubId));
  const config: ScenarioConfig = { hubIds: ids as string[], durationMinutes,
    tripDemandPct: bounded(raw, 'tripDemandPct', 0, -100, 200),
    chargingDemandPct: bounded(raw, 'chargingDemandPct', 0, -100, 200),
    blockedSlots: raw.blockedSlotsByHub === undefined ? bounded(raw, 'blockedSlots', 0, 0, slots.length, true) : 0,
    disabledPortsPct: bounded(raw, 'disabledPortsPct', 0, 0, 100),
    concentrationPct: bounded(raw, 'concentrationPct', 0, -100, 100),
    seed: bounded(raw, 'seed', 42, 0, 2 ** 31 - 1, true),
  };
  if (startTime !== undefined) config.startTime = startTime;
  if (endTime !== undefined) config.endTime = endTime;
  const byHub = raw.blockedSlotsByHub;
  if (byHub !== undefined) {
    if (!byHub || typeof byHub !== 'object' || Array.isArray(byHub))
      fail(400, 'INVALID_INPUT', 'Nhập số chỗ đỗ không khả dụng theo từng Hub.');
    const entries = Object.entries(byHub);
    for (const [id, count] of entries) {
      if (!ids.includes(id)) fail(400, 'INVALID_HUBS', 'Chỉ nhập số chỗ đỗ cho các Hub trong phạm vi.');
      const limit = slots.filter(slot => slot.hubId === id).length;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > limit) {
        const hub = entity(state.hubs, id, 'Hub');
        fail(400, 'INVALID_INPUT', `Số chỗ đỗ không khả dụng tại ${hub.name} phải là số nguyên từ 0 đến ${limit}.`);
      }
    }
    config.blockedSlotsByHub = Object.fromEntries(entries);
    config.blockedSlots = entries.reduce((sum, [, count]) => sum + count, 0);
  }
  return config;
}

function captureNetwork(state: State, config: ScenarioConfig, now: number): SimulationNetwork {
  const selected = (id: string | null): id is string => id !== null && config.hubIds.includes(id);
  const ports = state.points.filter(port => selected(port.hubId));
  const commitments: SimCommitment[] = [];
  for (const hold of state.holds.filter(row => selected(row.hubId) && row.status === 'Held' && (row.endAt === null || row.endAt > now))) {
    commitments.push({ id: hold.id, hubId: hold.hubId, slotId: hold.slotId, start: hold.startAt, end: hold.endAt });
  }
  for (const session of state.sessions.filter(row => row.pointId !== null && selected(row.hubId))) {
    if (session.status === 'Scheduled' && session.endAt > now) {
      commitments.push({ id: session.id, hubId: session.hubId, portId: session.pointId!,
        start: session.startAt, end: session.endAt, kw: session.powerKW });
    }
    if (['Starting', 'Charging', 'StopPending'].includes(session.status)) {
      commitments.push({ id: session.id, hubId: session.hubId, portId: session.pointId!, start: now,
        end: session.status === 'Charging' && session.endAt > now ? session.endAt : null, kw: session.powerKW });
    }
  }
  for (const port of ports.filter(row => row.pluggedVehicleId !== null && !commitments.some(item => item.portId === row.id && item.start <= now))) {
    commitments.push({ id: 'PLUGGED:' + port.id, hubId: port.hubId, portId: port.id, start: now, end: null });
  }
  return {
    capturedAt: now,
    hubs: state.hubs.filter(hub => selected(hub.id)).map(hub => ({ id: hub.id, power: hub.powerLimitKW })),
    slots: state.slots.filter(slot => selected(slot.hubId)).map(slot =>
      ({ id: slot.id, hubId: slot.hubId, kind: slot.type, occupiedBy: slot.vehicleId, blocked: slot.blocked })),
    ports: ports.map(port => ({ id: port.id, hubId: port.hubId, kw: port.ratedKW, connector: port.connectorType, blocked: port.blocked })),
    vehicles: state.vehicles.filter(vehicle => selected(vehicle.hubId) && vehicle.slotId !== null).map(vehicle => ({
      id: vehicle.id, hubId: vehicle.hubId!, slotId: vehicle.slotId!, battery: vehicle.batteryPercent ?? -1,
      available: movable(vehicle, vehicle.hubId!, now),
    })),
    commitments,
  };
}

interface SimulationInput { network: SimulationNetwork; config: SimulationConfig; seed: string }

export async function computeSimulation(run: Run) {
  const input = run.input as SimulationInput | undefined;
  if (!input?.network || !input?.config || !input?.seed) throw new Error('Thiếu dữ liệu snapshot của lượt mô phỏng.');
  const steps = whatIf(input.network,input.config,input.seed);
  for (let count = 0; ; count++) {
    const step = steps.next();
    if (step.done) return { ...step.value, snapshotVersion:run.snapshotVersion };
    if (count % 8 === 0) await setImmediate();
  }
}

function publicRun(run: Run) {
  const { input: _snapshot, ...result } = run;
  return result;
}

function publicScenario(state: State, scenario: Scenario): Scenario {
  const { config } = scenario;
  if (config.blockedSlotsByHub || !config.blockedSlots) return scenario;
  const slots = state.slots.filter(slot => config.hubIds.includes(slot.hubId)).map(slot => ({ ...slot, occupiedBy: slot.vehicleId }));
  const counts: Record<string, number> = {};
  for (const { hubId } of blockCandidates(slots).slice(0, config.blockedSlots)) counts[hubId] = (counts[hubId] ?? 0) + 1;
  return { ...scenario, legacyBlockedSlotsByHub: counts };
}

function registerSimulations(add: AddRoute): void {
  const base = '/operator/scenarios';
  const configInput = (input: Input): Input => input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? input.config as Input : input;
  add('GET', base, 'OPERATOR', tx => [...tx.state.scenarios].reverse().map(scenario => publicScenario(tx.state, scenario)));
  add('POST', base, 'OPERATOR', (tx, input) => {
    const name = requiredString(input, 'name');
    if (name.length > 80) fail(400, 'INVALID_INPUT', 'Tên kịch bản tối đa 80 ký tự.');
    const config = configured(tx, configInput(input));
    const latest = tx.state.scenarios.reduce((max, scenario) => {
      const match = /^SC-(\d+)$/.exec(scenario.id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const scenario = { id: 'SC-' + String(latest + 1).padStart(3, '0'), name, config, version: 1 };
    tx.state.scenarios.push(scenario);
    tx.log('SIMULATION_SCENARIO_CREATED', scenario.id, 'Đã lưu kịch bản.');
    return publicScenario(tx.state, scenario);
  });
  add('PATCH', base + '/:id', 'OPERATOR', (tx, input) => {
    const scenario = entity(tx.state.scenarios, requiredString(input, 'id'), 'kịch bản');
    checkVersion(input, scenario);
    const name = input.name === undefined ? scenario.name : requiredString(input, 'name');
    if (name.length > 80) fail(400, 'INVALID_INPUT', 'Tên kịch bản tối đa 80 ký tự.');
    const incoming = configInput(input);
    const raw: Input = { ...scenario.config, ...incoming };
    if (incoming.durationMinutes !== undefined && incoming.startTime === undefined && incoming.endTime === undefined) {
      delete raw.startTime;
      delete raw.endTime;
    }
    if (incoming.blockedSlotsByHub === undefined && scenario.config.blockedSlotsByHub) {
      const hubIds = incoming.hubIds;
      if (incoming.blockedSlots !== undefined) delete raw.blockedSlotsByHub;
      else if (Array.isArray(hubIds))
        raw.blockedSlotsByHub = Object.fromEntries(Object.entries(scenario.config.blockedSlotsByHub).filter(([id]) => hubIds.includes(id)));
    }
    const config = configured(tx, raw, scenario.config);
    Object.assign(scenario, { name, config, version: scenario.version + 1 });
    tx.log('SIMULATION_SCENARIO_UPDATED', scenario.id, 'Đã cập nhật kịch bản.');
    return publicScenario(tx.state, scenario);
  });
  add('POST', base + '/:id/runs', 'OPERATOR', (tx, input) => {
    const scenario = entity(tx.state.scenarios, requiredString(input, 'id'), 'kịch bản');
    if (input.version !== undefined || input.expectedVersion !== undefined) checkVersion(input, scenario);
    if (tx.state.runs.filter(run => run.status === 'Running').length >= 3)
      fail(409, 'SIMULATION_BUSY', 'Đã có 3 lượt đang chạy. Đợi kết quả rồi thử lại.');
    const config: SimulationConfig = { name: scenario.name, hubIds: [...scenario.config.hubIds], hours: scenario.config.durationMinutes / 60,
      tripChangePct: scenario.config.tripDemandPct, chargingChangePct: scenario.config.chargingDemandPct,
      unavailablePortPct: scenario.config.disabledPortsPct, blockedSlots: scenario.config.blockedSlots,
      concentrationPct: scenario.config.concentrationPct };
    const { startTime, endTime, blockedSlotsByHub } = scenario.config;
    if (startTime !== undefined || endTime !== undefined) {
      const { startAt, endAt } = dailyScenarioWindow(tx.now, startTime, endTime, true);
      config.startAt = startAt;
      config.hours = (endAt - startAt) / (60 * MINUTE);
    }
    if (blockedSlotsByHub) config.blockedSlotsByHub = blockedSlotsByHub;
    const network = captureNetwork(tx.state, scenario.config, tx.now);
    const run: Run = { id: tx.id('RUN'), scenarioId: scenario.id, status: 'Running', createdAt: tx.now,
      finishedAt: null, error: null, result: null, snapshotVersion: tx.state.version,
      input: { network, config, seed: scenario.config.seed.toString() } satisfies SimulationInput };
    tx.state.runs.push(run);
    tx.log('SIMULATION_STARTED', run.id, 'Đã chụp dữ liệu và xếp lượt mô phỏng.');
    return publicRun(run);
  });
  add('GET', '/operator/runs', 'OPERATOR', tx => [...tx.state.runs].reverse().map(publicRun));
  add('GET', '/operator/runs/:id', 'OPERATOR', (tx, input) => publicRun(entity(tx.state.runs, requiredString(input, 'id'), 'lượt mô phỏng')));
}

export function registerM3(add: AddRoute): void {
  registerRedistribution(add);
  registerChargingPlans(add);
  registerSimulations(add);
}
