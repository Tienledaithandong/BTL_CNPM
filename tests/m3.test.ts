import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { applyIncidentImpact, chargingPriority, computeSimulation, registerM3, runWhatIf,
  type SimulationConfig, type SimulationNetwork } from '../src/api/m3.js';
import { createApp } from '../src/api/app.js';
import { Store } from '../src/api/store.js';
import { DomainError, type Actor, type AddRoute, type ChargingPlan, type Handler, type Input,
  type Order, type Run, type Scenario, type Session } from '../src/api/types.js';

const now = Date.UTC(2026, 10, 18, 12);
const operator: Actor = { id: 'OPERATOR_A', role: 'OPERATOR' };
const handlers = new Map<string, Handler>();
const add: AddRoute = (method, path, _role, handler) => { handlers.set(method + ' ' + path, handler); };
registerM3(add);

async function fixture(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'mobility-m3-'));
  const store = await Store.open(path, () => now);
  t.after(async () => { await store.close(); await rm(path, { recursive: true, force: true }); });
  return store;
}

async function write<T>(store: Store, key: string, input: Input): Promise<T> {
  const handler = handlers.get(key);
  assert.ok(handler, key);
  return (await store.write(operator, tx => handler(tx, input))).data as T;
}

const red = '/operator/redistributions';
const plans = '/operator/charging-plans';
const scenarios = '/operator/scenarios';

function isCode(code: string) {
  return (error: unknown) => error instanceof DomainError && error.code === code;
}

test('UC12: confirms atomic allocation, preserves incident holds, and concludes arrival', async t => {
  const store = await fixture(t);
  const { id } = await write<Order>(store, 'POST ' + red, { sourceHubId:'H_METRO', destinationHubId:'H_BK', quantity:2 });
  let order = await write<Order>(store, 'POST ' + red + '/:id/confirm', { id, version:1 });
  assert.equal(order.status, 'Confirmed');
  const [first, second] = order.items;
  const allocated = store.snapshot();
  const firstSlot = allocated.vehicles.find(v => v.id === first.vehicleId)?.slotId;
  assert.ok(firstSlot);
  assert.equal(allocated.holds.find(h => h.id === first.holdId)?.ownerId, first.id);
  assert.equal(allocated.vehicles.find(v => v.id === first.vehicleId)?.allocationOwner?.id, first.id);
  order = await write<Order>(store, 'POST ' + red + '/:id/start', { id, version:order.version, itemIds:[first.id] });
  assert.equal(order.status, 'InTransit');
  assert.equal(store.snapshot().slots.find(s => s.id === firstSlot)?.vehicleId, null);
  await store.write(operator, tx => applyIncidentImpact(tx, first.vehicleId));
  order = store.snapshot().orders.find(value => value.id === id)!;
  assert.equal(order.items[0].status, 'NeedsOperatorAction');
  assert.equal(order.items[0].departedAt, now);
  assert.equal(store.snapshot().holds.find(h => h.id === second.holdId)?.status, 'Held');
  await assert.rejects(write(store, 'POST ' + red + '/:id/cancel', { id, version:order.version }), isCode('INVALID_TRANSITION'));
  order = await write<Order>(store, 'POST ' + red + '/:id/resolve-item', { id, version:order.version, itemId:first.id, action:'resume' });
  await assert.rejects(write(store, 'POST ' + red + '/:id/arrivals', { id, version:order.version, itemId:first.id, hubId:'H_KTX' }), isCode('WRONG_HUB'));
  order = await write<Order>(store, 'POST ' + red + '/:id/arrivals', { id, version:order.version, itemId:first.id, hubId:'H_BK' });
  assert.equal(order.items[0].status, 'Arrived');
  const arrived = store.snapshot();
  const vehicle = arrived.vehicles.find(v => v.id === first.vehicleId)!;
  assert.equal(vehicle.hubId, 'H_BK');
  assert.equal(vehicle.allocationOwner, null);
  assert.equal(arrived.slots.find(s => s.id === vehicle.slotId)?.vehicleId, vehicle.id);
  assert.notEqual(arrived.holds.find(h => h.id === first.holdId)?.status, 'Held');
  order = await write<Order>(store, 'POST ' + red + '/:id/start', { id, version:order.version });
  order = await write<Order>(store, 'POST ' + red + '/:id/arrivals', { id, version:order.version, itemId:second.id, hubId:'H_BK' });
  assert.equal(order.status, 'Arrived');
  order = await write<Order>(store, 'POST ' + red + '/:id/complete', { id, version:order.version });
  assert.equal(order.status, 'Completed');
});

test('UC12: when only one destination slot remains, two-item confirmation leaves no allocations', async t => {
  const store = await fixture(t);
  await store.write(operator, tx => {
    const free = tx.state.slots.filter(s => s.hubId === 'H_BK' && s.type === 'SHARED' && s.vehicleId === null);
    for (const slot of free.slice(1)) slot.blocked = true;
  });
  const order = await write<Order>(store, 'POST ' + red, { sourceHubId:'H_METRO', destinationHubId:'H_BK', quantity:2 });
  const before = store.snapshot();
  await assert.rejects(write(store, 'POST ' + red + '/:id/confirm', { id:order.id, version:order.version }), isCode('NO_PARKING_CAPACITY'));
  assert.deepEqual(store.snapshot(), before);
});

function waiting(id: string, vehicleId: string, percent: number): Session {
  return { id, hubId:'H_METRO', vehicleId, userId:'STUDENT_A', private:false, bookingId:null, requestedPointId:null, pointId:null,
    startAt:now, endAt:now + 60000, powerKW:2, currentPercent:percent, targetPercent:80, status:'Waiting',
    commandId:null, waitingSince:now, neededAt:now + 60 * 60000, version:1, startedAt:null, updatedAt:now };
}

test('UC14: priority preview is nonbinding, ignores unrelated versions and honours Hub power', async t => {
  const store = await fixture(t);
  assert.equal(chargingPriority(20, now + 2 * 3600000, now), 85);
  assert.equal(chargingPriority(40, now + 2 * 3600000, now), 65);
  assert.equal(chargingPriority(30, null, now), 70);
  assert.ok(Number.isFinite(chargingPriority(30, now - 1, now)));
  await store.write(operator, tx => { tx.state.sessions.push(waiting('WAIT-A','EV-03',25), waiting('WAIT-B','EV-04',15)); });
  const proposal = await write<ChargingPlan>(store, 'POST ' + plans + '/preview', { hubId:'H_METRO' });
  assert.equal(proposal.assignments.length, 2);
  assert.deepEqual(proposal.assignments.map(a => a.sessionId), ['WAIT-B','WAIT-A']);
  assert.ok(proposal.assignments[0].endAt <= proposal.assignments[1].startAt);
  assert.ok(store.snapshot().sessions.every(s => s.status === 'Waiting'));
  await store.write(operator, tx => { tx.state.hubs.find(h => h.id === 'H_BK')!.lastSeenAt = now + 1; });
  const applied = await write<ChargingPlan & { sessionIds:string[] }>(store, 'POST ' + plans + '/:id/apply',
    { id:proposal.id, version:proposal.version });
  assert.deepEqual(applied.sessionIds, ['WAIT-B','WAIT-A']);
  assert.ok(store.snapshot().sessions.every(s => s.status === 'Scheduled'));
});

test('UC14: apply detects changed point constraints and rolls back all assignments', async t => {
  const store = await fixture(t);
  await store.write(operator, tx => { tx.state.sessions.push(waiting('WAIT-A','EV-03',25), waiting('WAIT-B','EV-04',15)); });
  const proposal = await write<ChargingPlan>(store, 'POST ' + plans + '/preview', { hubId:'H_METRO' });
  assert.equal(proposal.assignments.length, 2);
  await store.write(operator, tx => { tx.state.points.find(point => point.id === proposal.assignments[1].pointId)!.blocked = true; });
  const before = store.snapshot();
  await assert.rejects(write(store, 'POST ' + plans + '/:id/apply', { id:proposal.id, version:proposal.version }),
    isCode('CHARGING_PLAN_CONFLICT'));
  assert.deepEqual(store.snapshot(), before);
});

test('UC16: deterministic 2/1 baseline versus 1/2 when one destination slot is blocked', () => {
  const network: SimulationNetwork = {
    capturedAt:now, hubs:[{ id:'A', power:3 }, { id:'B', power:3 }], ports:[], commitments:[],
    slots:[{ id:'A1', hubId:'A', kind:'SHARED', occupiedBy:'V1', blocked:false },
      { id:'A2', hubId:'A', kind:'SHARED', occupiedBy:'V2', blocked:false },
      { id:'B1', hubId:'B', kind:'SHARED', occupiedBy:null, blocked:false },
      { id:'B2', hubId:'B', kind:'SHARED', occupiedBy:null, blocked:false }],
    vehicles:[{ id:'V1', hubId:'A', battery:80, slotId:'A1', available:true },
      { id:'V2', hubId:'A', battery:80, slotId:'A2', available:true }],
  };
  const demand = { trips:[1,2,3].map(value => ({ id:'T' + value, at:now, from:'A', to:'B' })), charges:[] };
  const config: SimulationConfig = { name:'Fixture', hubIds:['A','B'], hours:1, tripChangePct:0, chargingChangePct:0,
    unavailablePortPct:0, blockedSlots:1 };
  const before = structuredClone(network);
  const result = runWhatIf(network, config, '42', demand);
  assert.deepEqual([result.baseline.metrics.servedTrips,result.baseline.metrics.rejectedTrips], [2,1]);
  assert.deepEqual([result.scenario.metrics.servedTrips,result.scenario.metrics.rejectedTrips], [1,2]);
  assert.deepEqual([result.delta.servedTrips,result.delta.rejectedTrips], [-1,1]);
  assert.deepEqual(result, runWhatIf(network, config, '42', demand));
  assert.deepEqual(network, before);
  const neutral = runWhatIf(network, { ...config, blockedSlots:0 }, '42', demand);
  assert.ok(Object.values(neutral.delta).every(value => value === 0 || value === null));
});

test('UC16: an alternative uses a compatible port and a slot for its full power window', () => {
  const hour = 60 * 60_000;
  const network: SimulationNetwork = {
    capturedAt:now,hubs:[{id:'A',power:3}],vehicles:[],
    ports:[{id:'C1',hubId:'A',kw:2,connector:'TYPE2',blocked:false},{id:'C2',hubId:'A',kw:2,connector:'TYPE2',blocked:false}],
    slots:[{id:'P1',hubId:'A',kind:'PRIVATE',occupiedBy:null,blocked:false}],
    commitments:[{id:'LIVE',hubId:'A',portId:'C1',kw:2,start:now,end:now+2*hour},
      {id:'PARK',hubId:'A',slotId:'P1',start:now+hour+15*60_000,end:now+hour+30*60_000}],
  };
  const demand = {trips:[],charges:[{id:'CH-1',at:now,hubId:'A',kwh:2,connector:'TYPE2',battery:20,neededAt:null}]};
  const config = {name:'Fixture',hubIds:['A'],hours:1,tripChangePct:0,chargingChangePct:0,unavailablePortPct:0,blockedSlots:0};
  const result = runWhatIf(network,config,'42',demand);
  assert.equal(result.scenario.metrics.waitingChargingCount,1);
  assert.deepEqual(result.recommendations[0].window,{
    requestId:'CH-1',pointId:'C2',slotId:'P1',startAt:now+hour+30*60_000,endAt:now+3*hour+30*60_000,powerKW:1,energyKWh:2,
  });
  const blocked = runWhatIf(network,{...config,unavailablePortPct:100},'42',demand);
  assert.equal(blocked.recommendations[0].operation,'NoFeasibleCharging');
  assert.equal(blocked.recommendations[0].window,undefined);
});

test('UC15/16: captured run remains repeatable when scenario and live vehicle later change', async t => {
  const store = await fixture(t);
  const scenario = await write<Scenario>(store, 'POST ' + scenarios,
    { name:'Nhu cầu metro', hubIds:['H_METRO','H_KTX'], durationMinutes:120, seed:42, tripDemandPct:40, blockedSlots:2 });
  const view = await write<Run>(store, 'POST ' + scenarios + '/:id/runs', { id:scenario.id, version:scenario.version });
  assert.equal(view.status, 'Running');
  assert.equal(view.input, undefined);
  const run = store.snapshot().runs.find(r => r.id === view.id)!;
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const result = await computeSimulation(run);
  assert.equal(yielded,true);
  await write<Scenario>(store, 'PATCH ' + scenarios + '/:id', { id:scenario.id, version:scenario.version, tripDemandPct:100 });
  await store.write(operator, tx => { tx.state.vehicles[0].batteryPercent = 1; });
  assert.deepEqual(await computeSimulation(store.snapshot().runs.find(r => r.id === run.id)!), result);
  assert.equal(store.snapshot().vehicles[0].batteryPercent, 1);
});

test('UC12: cancelling before departure releases every owned destination hold and retains source occupancy', async t => {
  const store = await fixture(t);
  const { id } = await write<Order>(store, 'POST ' + red, { sourceHubId:'H_METRO', destinationHubId:'H_KTX', quantity:2 });
  let order = await write<Order>(store, 'POST ' + red + '/:id/confirm', { id, version:1 });
  const before = store.snapshot();
  order = await write<Order>(store, 'POST ' + red + '/:id/cancel', { id, expectedVersion:order.version });
  assert.equal(order.status, 'Cancelled');
  const state = store.snapshot();
  assert.deepEqual(state.slots, before.slots);
  for (const item of order.items) {
    assert.equal(item.status, 'Cancelled');
    assert.notEqual(state.holds.find(h => h.id === item.holdId)?.status, 'Held');
    assert.equal(state.vehicles.find(v => v.id === item.vehicleId)?.allocationOwner, null);
  }
});

test('UC15/16 HTTP: operator reads Completed outcome after worker, queued run becomes Interrupted on restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mobility-simulation-http-'));
  const options = { directory, clock:() => now, background:false };
  let system = await createApp(options);
  t.after(async () => {
    await system.app.close();
    await rm(directory, { recursive:true, force:true });
  });
  async function login() {
    const response = await system.app.inject({ method:'POST', url:'/api/auth/login', payload:{ userId:'OPERATOR_A', password:'demo' } });
    assert.equal(response.statusCode, 200, response.body);
    const entry = response.headers['set-cookie'];
    const cookie = (Array.isArray(entry) ? entry[0] : entry)?.split(';')[0];
    assert.ok(cookie);
    return { cookie };
  }
  let headers = await login();
  const created = await system.app.inject({ method:'POST', url:'/api/operator/scenarios', headers, payload:{
    name:'So sánh ga Metro', hubIds:['H_METRO','H_BK','H_KTX'], durationMinutes:360, tripDemandPct:40, blockedSlots:2, seed:87,
  } });
  assert.equal(created.statusCode, 200, created.body);
  const scenario = created.json<{ data:Scenario }>().data;
  const runRoute = '/api/operator/scenarios/' + scenario.id + '/runs';
  const viewRun = (id: string) => system.app.inject({ method:'GET', url:'/api/operator/runs/' + id, headers });
  const queued = await system.app.inject({ method:'POST', url:runRoute, headers, payload:{ expectedVersion:scenario.version } });
  assert.equal(queued.statusCode, 200, queued.body);
  const run = queued.json<{ data:Run }>().data;
  assert.equal(run.status, 'Running');
  const operational = (snapshot: ReturnType<Store['snapshot']>) =>
    ({ vehicles:snapshot.vehicles, slots:snapshot.slots, holds:snapshot.holds, sessions:snapshot.sessions, points:snapshot.points });
  const before = operational(system.store.snapshot());
  await system.tick();
  const received = await viewRun(run.id);
  assert.equal(received.statusCode, 200, received.body);
  const finished = received.json<{ data:Run }>().data;
  assert.equal(finished.status, 'Completed');
  assert.equal(finished.finishedAt, new Date(now).toISOString());
  assert.ok(finished.result);
  assert.equal(finished.input, undefined);
  const listed = await system.app.inject({ method:'GET', url:'/api/operator/runs', headers });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.ok(listed.json<{ data:Run[] }>().data.some(value => value.id === run.id));
  assert.deepEqual(operational(system.store.snapshot()), before);
  const next = await system.app.inject({ method:'POST', url:runRoute, headers, payload:{ expectedVersion:scenario.version } });
  assert.equal(next.statusCode, 200, next.body);
  const interrupted = next.json<{ data:Run }>().data;
  assert.equal(interrupted.status, 'Running');
  await system.app.close();
  system = await createApp(options);
  headers = await login();
  const result = await viewRun(interrupted.id);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json<{data:Run}>().data.status, 'Failed');
  assert.equal(result.json<{data:Run}>().data.error, 'INTERRUPTED');
  const reopened = await viewRun(run.id);
  assert.equal(reopened.statusCode, 200, reopened.body);
  assert.deepEqual(reopened.json<{data:Run}>().data, finished);
  assert.deepEqual(operational(system.store.snapshot()), before);
});

test('A32: charging plan preview rejects duplicate and unknown overrides', async t => {
  const store = await fixture(t);
  await store.write(operator, tx => { tx.state.sessions.push(waiting('WAIT-A','EV-03',25)); });
  await assert.rejects(write(store, 'POST ' + plans + '/preview', { hubId:'H_METRO', overrides:['WAIT-A','WAIT-A'] }), isCode('INVALID_OVERRIDE'));
  await assert.rejects(write(store, 'POST ' + plans + '/preview', { hubId:'H_METRO', overrides:['ghost'] }), isCode('INVALID_OVERRIDE'));
  const proposal = await write<ChargingPlan>(store, 'POST ' + plans + '/preview', { hubId:'H_METRO', overrides:['WAIT-A'] });
  assert.equal(proposal.assignments.length, 1);
  assert.equal(proposal.assignments[0].sessionId, 'WAIT-A');
});

test('A33: scenario PATCH updates configuration and bumps version', async t => {
  const store = await fixture(t);
  const scenario = await write<Scenario>(store, 'POST ' + scenarios,
    { name:'Nhu cầu metro', hubIds:['H_METRO','H_KTX'], durationMinutes:120, seed:42, tripDemandPct:40 });
  const patched = await write<Scenario>(store, 'PATCH ' + scenarios + '/:id',
    { id:scenario.id, version:scenario.version, name:'Nhu cầu hệ thống', tripDemandPct:100, chargingDemandPct:-20 });
  assert.equal(patched.name, 'Nhu cầu hệ thống');
  assert.equal(patched.config.tripDemandPct, 100);
  assert.equal(patched.config.chargingDemandPct, -20);
  assert.equal(patched.version, scenario.version + 1);
});

test('A35: charging plan energy follows the session estimate when telemetry lags', async t => {
  const store = await fixture(t);
  await store.write(operator, tx => {
    tx.state.vehicles.find(v => v.id === 'EV-03')!.batteryPercent = 10;
    tx.state.sessions.push(waiting('WAIT-A','EV-03',25));
  });
  const proposal = await write<ChargingPlan>(store, 'POST ' + plans + '/preview', { hubId:'H_METRO' });
  assert.equal(proposal.assignments.length, 1);
  const span = proposal.assignments[0].endAt - proposal.assignments[0].startAt;
  assert.ok(span >= 66*60000 && span <= 68*60000, String(span));
});
