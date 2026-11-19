export type Role = 'STUDENT' | 'OPERATOR' | 'SYSTEM';
export interface Actor { id: string; role: Role }
export interface Hub { id: string; name: string; location: { lat: number; lng: number }; powerLimitKW: number; lastSeenAt: number | null }
export interface Vehicle {
  id: string; type: string; hubId: string | null; slotId: string | null; batteryPercent: number | null;
  observedAt: number | null; sequence: number; healthStatus: 'OK' | 'Maintenance' | 'Faulty';
  mobilityStatus: 'Available' | 'Reserved' | 'UnlockPending' | 'InUse' | 'NeedsCharge' | 'Charging' | 'InTransit';
  allocationOwner: { type: 'SHARED_RESERVATION' | 'TRIP' | 'REDISTRIBUTION_ITEM'; id: string } | null;
  connectorType: string; capacityKWh: number; version: number;
}
export interface Slot { id: string; hubId: string; type: 'SHARED' | 'PRIVATE'; vehicleId: string | null; blocked: boolean }
export interface Hold {
  id: string; slotId: string; hubId: string; ownerType: 'SHARED_RESERVATION' | 'TRIP' | 'REDISTRIBUTION_ITEM' | 'PRIVATE_VEHICLE';
  ownerId: string; startAt: number; endAt: number | null; status: 'Held' | 'Occupied' | 'Released' | 'Cancelled';
}
export interface PrivateVehicle { id: string; userId: string; plate: string; capacityKWh: number; connectorType: string }
export interface Point {
  id: string; hubId: string; connectorType: string; ratedKW: number; blocked: boolean;
  pluggedVehicleId: string | null; powered: boolean;
}
export type SessionStatus = 'Scheduled'|'Waiting'|'Starting'|'Charging'|'StopPending'|'Completed'|'Stopped'|'Cancelled'|'Failed';
export interface Session {
  id: string; hubId: string; vehicleId: string; userId: string; private: boolean; bookingId: string | null;
  requestedPointId: string | null; pointId: string | null; startAt: number; endAt: number;
  powerKW: number; currentPercent: number; targetPercent: number; status: SessionStatus; commandId: string | null;
  waitingSince: number; neededAt: number | null; version: number; startedAt: number | null; updatedAt: number;
  desiredStop?: 'Completed'|'Stopped'|'Cancelled'|'Failed';
}
export interface Reservation {
  id: string; userId: string; vehicleId: string; holdId: string; token: string; expiresAt: number;
  status: 'Reserved'|'UnlockPending'|'Used'|'Cancelled'|'Expired'; commandId: string | null; version: number;
}
export interface Trip { id: string; userId: string; vehicleId: string; holdId: string; startedAt: number; endedAt: number | null; version: number }
export interface Invoice { id: string; tripId: string; amountVnd: number; userId: string; createdAt: number }
export interface ChargingRequest { id: string; sessionId: string; userId: string; vehicleId: string; createdAt: number }
export interface ParkingBooking {
  id: string; userId: string; vehicleId: string; hubId: string; slotId: string; holdId: string; startAt: number; endAt: number;
  status: 'Scheduled'|'InUse'|'Completed'|'Cancelled'; serviceStatus: 'Normal'|'Delayed'; guarantee: 'Guaranteed'|'NotGuaranteed';
  costVnd: number; version: number;
}
export interface Alert { id: string; hubId: string; type: 'PARKING'|'CHARGING'; status: 'Open'|'Resolved'; openedAt: number; acknowledgedAt: number|null; resolvedAt: number|null; version: number }
export interface Incident { id: string; resourceType: 'vehicle'|'point'|'slot'; resourceId: string; description: string; userId: string; status: 'Reported'|'Isolated'|'Resolved'; impacts: string[]; ticketId: string|null; version: number }
export interface Item { id: string; vehicleId: string; holdId: string; status: 'Allocated'|'InTransit'|'NeedsOperatorAction'|'Arrived'|'Completed'|'Dropped'|'Cancelled'; departedAt: number|null; arrivedAt: number|null }
export interface Order {
  id: string; sourceHubId: string; destinationHubId: string; quantity: number; version: number;
  status: 'Proposed'|'Confirmed'|'InTransit'|'Arrived'|'Completed'|'PartiallyCompleted'|'Failed'|'Cancelled'; items: Item[];
}
export interface PlanAssignment { sessionId: string; pointId: string; startAt: number; endAt: number; powerKW: number; priority: number }
export interface ChargingPlan { id: string; hubId: string; version: number; baseVersion: number; status: 'Proposed'|'Applied'; assignments: PlanAssignment[]; excluded: {sessionId:string;reason:string}[] }
export interface ScenarioConfig { hubIds:string[]; durationMinutes:number; tripDemandPct:number; chargingDemandPct:number; blockedSlots:number; disabledPortsPct:number; concentrationPct:number; seed:number }
export interface Scenario { id:string; name:string; config:ScenarioConfig; version:number }
export interface Run { id:string; scenarioId:string; status:'Running'|'Completed'|'Failed'; createdAt:number; finishedAt:number|null; result:unknown; error:string|null; snapshotVersion:number; input?: unknown }
export interface Command {
  id: string; type: 'UNLOCK'|'CHARGE_START'|'CHARGE_STOP'; resourceId: string; subjectId: string;
  status: 'Pending'|'Confirmed'|'Failed'; createdAt: number; expiresAt: number;
  dispatchedAt: number|null; attempts: number; nextProbeAt: number|null; probeCount: number;
}
export interface Notification { id: string; userId: string; message: string; createdAt: number; readAt: number|null }
export interface Activity { id: string; type: string; actorId: string; at: number; resourceId: string; detail: string }
export interface Idempotency { operation: string; hash: string; data: unknown; stateVersion: number }
export interface State {
  version: number; hubs: Hub[]; vehicles: Vehicle[]; slots: Slot[]; points: Point[]; holds: Hold[];
  privateVehicles: PrivateVehicle[]; reservations: Reservation[]; trips: Trip[]; invoices: Invoice[];
  chargingRequests: ChargingRequest[]; bookings: ParkingBooking[]; sessions: Session[];
  alerts: Alert[]; incidents: Incident[]; orders: Order[]; plans: ChargingPlan[]; scenarios: Scenario[]; runs: Run[];
  commands: Command[]; notifications: Notification[]; activity: Activity[]; idempotency: Record<string, Idempotency>;
  demo: { autoAck: boolean; pausedHubs: string[]; physicalEvidence: Record<string, { hubId:string; slotId:string; locked:boolean; observedAt:number }> };
}
export type Input = Record<string, unknown>;
export interface Tx {
  state: State; actor: Actor; now: number;
  id(prefix: string): string;
  log(type: string, resourceId: string, detail: string): void;
  notify(userId: string, message: string): void;
  command(type: Command['type'], resourceId: string, subjectId: string): Command;
}
export type Handler = (tx: Tx, input: Input) => unknown;
export type AddRoute = (method: 'GET'|'POST'|'PATCH', path: string, role: 'STUDENT'|'OPERATOR'|'ANY', handler: Handler, options?: { readOnly?: boolean }) => void;

export class DomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new DomainError(status, code, message, details);
}
export function requiredString(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) fail(400, 'INVALID_INPUT', `Thiếu hoặc sai trường ${key}.`);
  return value.trim();
}
export function number(input: Input, key: string): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(400, 'INVALID_INPUT', `Trường ${key} phải là số.`);
  return value;
}
export function instant(input: Input, key: string): number {
  const text = requiredString(input, key);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/i.test(text) || !Number.isFinite(Date.parse(text)))
    fail(400, 'INVALID_INPUT', `Thời gian ${key} cần có múi giờ.`);
  return Date.parse(text);
}
export function entity<T extends { id: string }>(entities: T[], id: string, label: string): T {
  return entities.find((entry) => entry.id === id) ?? fail(404, 'NOT_FOUND', `Không tìm thấy ${label}.`);
}
export function checkVersion(input: Input, row: { version: number }): void {
  const expected = input.expectedVersion ?? input.version;
  if (typeof expected !== 'number' || !Number.isInteger(expected)) fail(400, 'VERSION_REQUIRED', 'Cần phiên bản bản ghi.');
  if (row.version !== expected) fail(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi, hãy tải lại.');
}
export function owned(tx: Tx, userId: string): void {
  if (tx.actor.role !== 'OPERATOR' && tx.actor.role !== 'SYSTEM' && tx.actor.id !== userId)
    fail(403, 'FORBIDDEN', 'Bạn không có quyền với dữ liệu này.');
}
export function fresh(vehicle: Vehicle, now: number): boolean {
  return vehicle.observedAt !== null && vehicle.batteryPercent !== null && now - vehicle.observedAt <= 60_000 && now >= vehicle.observedAt;
}
export function refreshAvailability(vehicle: Vehicle, at: number, threshold = 20): void {
  if (!vehicle.allocationOwner) vehicle.mobilityStatus = vehicle.healthStatus === 'OK' && fresh(vehicle, at) && (vehicle.batteryPercent ?? 0) >= threshold ? 'Available' : 'NeedsCharge';
}
