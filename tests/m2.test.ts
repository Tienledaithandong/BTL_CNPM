import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/api/app.js';
import { parkingAlertOpen } from '../src/api/m2.js';
import type { Input, ParkingBooking, Session } from '../src/api/types.js';

const start = Date.UTC(2026, 10, 18, 1);
const minute = 60_000;
const iso = (value: number) => new Date(value).toISOString();

async function fixture(t: TestContext, slotsPerHub?: number) {
  let now = start;
  const directory = await mkdtemp(join(tmpdir(), 'mobility-m2-'));
  const { app, tick, store } = await createApp({ directory, background:false, clock:()=> now, slotsPerHub });
  t.after(async () => { await app.close(); await rm(directory, { recursive:true, force:true }); });
  async function login(userId: string) {
    const response = await app.inject({ method:'POST', url:'/api/auth/login', payload:{ userId, password:'demo' } });
    assert.equal(response.statusCode,200,response.body);
    const cookie = String(response.headers['set-cookie']).split(';')[0];
    return async (method: 'GET'|'POST', path: string, payload?: Input, status: number | number[] = 200) => {
      const answer = await app.inject({ method, url:'/api'+path, headers:{ cookie }, payload });
      assert.ok((Array.isArray(status) ? status : [status]).includes(answer.statusCode),answer.body);
      return answer.json();
    };
  }
  return { tick, store, login, setNow(value: number) { now = value; } };
}

const parkingInput = (privateVehicleId: string, from: number, to: number) => ({
  privateVehicleId, hubId:'H_METRO', startAt:iso(from), endAt:iso(to),
});

test('UC08 private parking uses half-open intervals, accurate preview and owner checks', async t => {
  const { store, login } = await fixture(t);
  const a = await login('STUDENT_A');
  const b = await login('STUDENT_B');
  const first = parkingInput('PV_A',start + 60*minute,start + 120*minute);
  const preview = await a('POST','/parking/preview',first);
  assert.equal(preview.data.entries[0].available,true);
  assert.equal(preview.data.costVnd,2000);
  assert.equal(store.snapshot().holds.length,0);
  await b('POST','/parking/bookings',first,403);
  const morning = (await a('POST','/parking/bookings',first)).data.bookings[0] as ParkingBooking;
  const boundary = (await a('POST','/parking/bookings',parkingInput('PV_A',start+120*minute,start+180*minute))).data.bookings[0] as ParkingBooking;
  assert.equal(morning.slotId,boundary.slotId);
  await a('POST','/parking/bookings',parkingInput('PV_A',start+90*minute,start+150*minute),409);
  const multi = { ...first, repeat:{ weekdays:[3,4], endDate:'2026-11-19' } };
  const mixed = (await a('POST','/parking/preview',multi)).data;
  assert.deepEqual(mixed.entries.map((e: { available:boolean })=>e.available),[false,true]);
  await a('POST','/parking/bookings',multi,409);
  const accepted = (await a('POST','/parking/bookings',{...multi,skipConflicts:true})).data;
  assert.equal(accepted.bookings.length,1);
  assert.equal(accepted.skipped.length,1);
});

test('UC09 capacity, ACK, StopPending and physical clearance are enforced via REST', async t => {
  const { tick, store, login, setNow } = await fixture(t);
  const a = await login('STUDENT_A');
  const b = await login('STUDENT_B');
  const op = await login('OPERATOR_A');
  const bookingA = (await a('POST','/parking/bookings',parkingInput('PV_A',start,start + 150*minute))).data.bookings[0];
  const bookingB = (await b('POST','/parking/bookings',parkingInput('PV_B',start,start + 150*minute))).data.bookings[0];
  await a('POST','/parking/bookings/'+bookingA.id+'/arrive',{version:bookingA.version});
  await b('POST','/parking/bookings/'+bookingB.id+'/arrive',{version:bookingB.version});
  const ch = { bookingId:bookingA.id, currentPercent:20, target:70, powerKW:2, startAt:iso(start + minute) };
  await b('POST','/charging/preview',ch,403);
  const preview = (await a('POST','/charging/preview',ch)).data;
  assert.deepEqual([preview.energyKWh,preview.durationMinutes],[2,60]);
  const aSession = (await a('POST','/charging/bookings',ch)).data as Session;
  assert.equal(aSession.status,'Scheduled');
  await b('POST','/charging/bookings',{...ch,bookingId:bookingB.id},409);
  const alternatives = (await b('POST','/charging/preview',{...ch,bookingId:bookingB.id})).data.suggestions;
  assert.ok(alternatives.some((row: { powerKW:number })=>row.powerKW===1));
  setNow(start + minute);
  await tick();
  let s = store.snapshot().sessions.find(row=>row.id===aSession.id)!;
  assert.equal(s.status,'Charging');
  assert.equal(store.snapshot().points.find(p=>p.id===s.pointId)?.powered,true);
  await op('POST','/operator/demo/events',{kind:'autoAck',enabled:false});
  s = (await a('POST','/charging/sessions/'+s.id+'/stop',{version:s.version})).data as Session;
  assert.equal(s.status,'StopPending');
  setNow(start + 70*minute);
  await tick();
  assert.equal(store.snapshot().points.find(p=>p.id===s.pointId)?.powered,true);
  await op('POST','/operator/demo/events',{kind:'plug', pointId:s.pointId,vehicleId:null},409);
  await op('POST','/operator/demo/events',{kind:'ack',commandId:s.commandId,success:false});
  assert.equal(store.snapshot().sessions.find(row=>row.id===aSession.id)?.status,'StopPending');
  await op('POST','/operator/demo/events',{kind:'ack',commandId:s.commandId,success:true});
  let point = store.snapshot().points.find(p=>p.id===s.pointId)!;
  assert.equal(point.powered,false);
  assert.equal(point.pluggedVehicleId,'PV_A');
  const overview = (await op('GET','/operator/overview')).data;
  assert.equal(overview.hubs[0].points.find((p:{id:string})=>p.id===point.id).occupancy,'NeedsClear');
  await op('POST','/operator/demo/events',{kind:'plug',pointId:s.pointId,vehicleId:null});
  point = store.snapshot().points.find(p=>p.id===s.pointId)!;
  assert.equal(point.pluggedVehicleId,null);
});

test('UC10/11 parking thresholds are exact and heartbeat pause exposes stale observations', async t => {
  assert.equal(parkingAlertOpen(false,89,100),false);
  assert.equal(parkingAlertOpen(false,90,100),true);
  assert.equal(parkingAlertOpen(true,85,100),true);
  assert.equal(parkingAlertOpen(true,84,100),false);
  assert.equal(parkingAlertOpen(false,0,0),false);
  const { tick, login, setNow } = await fixture(t);
  const op = await login('OPERATOR_A');
  await op('POST','/operator/demo/events',{kind:'heartbeat',hubId:'H_METRO',paused:true});
  setNow(start + 11_000);
  await tick();
  const { hubs } = (await op('GET','/operator/overview')).data;
  const metro = hubs.find((h: {id:string})=> h.id==='H_METRO');
  assert.equal(metro.stale,true);
  assert.equal(metro.parkingOccupancyPct,null);
  assert.equal(metro.occupiedSlots,6);
  assert.equal(metro.availableSlots,0);
});

test('UC13 isolated reserved vehicle is replaced once while preserving its destination hold', async t => {
  const { store, login } = await fixture(t);
  const a = await login('STUDENT_A');
  const op = await login('OPERATOR_A');
  const reservation = (await a('POST','/reservations',{vehicleId:'EV-01',destinationHubId:'H_BK'})).data;
  const incident = (await op('POST','/incidents',{resourceType:'vehicle',resourceId:'EV-01',description:'Lỗi bánh xe'})).data;
  const isolated = (await op('POST','/operator/incidents/'+incident.id+'/isolate',{version:incident.version})).data;
  assert.equal(isolated.status,'Isolated');
  assert.equal(isolated.impacts.length,1);
  await op('POST','/operator/incidents/'+incident.id+'/isolate',{version:isolated.version});
  const after = store.snapshot();
  const record = after.reservations.find(r=>r.id===reservation.id)!;
  assert.notEqual(record.vehicleId,'EV-01');
  assert.equal(record.holdId,reservation.holdId);
  assert.equal(after.vehicles.find(v=>v.id===record.vehicleId)?.allocationOwner?.id,reservation.id);
  assert.equal(after.vehicles.find(v=>v.id==='EV-01')?.healthStatus,'Maintenance');
  assert.equal(after.activity.filter(a=>a.type==='INCIDENT_ISOLATED').length,1);
});

test('UC07 shared charging enforces last Trip ownership, request deduplication, and distinguishes unavailable from incompatible points', async t => {
  const { tick, store, login, setNow } = await fixture(t);
  const a = await login('STUDENT_A');
  const b = await login('STUDENT_B');
  const op = await login('OPERATOR_A');
  await a('POST','/charging/requests',{ vehicleId:'EV-04' },403);
  const startCharge = (await op('POST','/charging/requests',{ vehicleId:'EV-04',chargingPointId:'H_METRO-C1' })).data;
  assert.equal(startCharge.session.status,'Starting');
  const queued = (await op('POST','/charging/requests',{ vehicleId:'EV-02',chargingPointId:'H_METRO-C2' })).data;
  assert.equal(queued.session.status,'Waiting');
  const duplicate = (await op('POST','/charging/requests',{ vehicleId:'EV-02' })).data;
  assert.equal(duplicate.session.id,queued.session.id);
  assert.equal(store.snapshot().sessions.filter(s=>s.vehicleId==='EV-02').length,1);
  const reservation = (await a('POST','/reservations',{ vehicleId:'EV-03',destinationHubId:'H_BK' })).data;
  await a('POST','/reservations/'+reservation.id+'/pickup',{ version:reservation.version,token:reservation.token });
  await tick();
  const [trip] = (await a('GET','/me/trips')).data;
  const returned = (await a('POST','/trips/'+trip.id+'/return',{ version:trip.version,hubId:'H_BK',slotId:trip.hold.slotId })).data;
  assert.equal(returned.endedAt,new Date(start).toISOString());
  await b('POST','/charging/requests',{ vehicleId:'EV-03' },403);
  const bad = await a('POST','/charging/requests',{ vehicleId:'EV-03',chargingPointId:'H_METRO-C1' },409);
  assert.equal(bad.error.code,'POINT_INCOMPATIBLE');
  await op('POST','/operator/demo/events',{ kind:'plug',pointId:'H_BK-C1',vehicleId:'EV-03' });
  const mismatch = await a('POST','/charging/requests',{ vehicleId:'EV-03',chargingPointId:'H_BK-C2' },409);
  assert.equal(mismatch.error.code,'POINT_MISMATCH');
  const own = (await a('POST','/charging/requests',{ vehicleId:'EV-03',chargingPointId:'H_BK-C1' })).data;
  assert.equal(own.session.status,'Starting');
  assert.equal(own.request.userId,'STUDENT_A');
  await tick();
  const active = store.snapshot().sessions.find(row=>row.id===own.session.id)!;
  await a('POST','/charging/sessions/'+active.id+'/stop',{ version:active.version });
  await tick();
  await op('POST','/operator/demo/events',{ kind:'plug',pointId:active.pointId,vehicleId:null });
  setNow(start + 31*minute);
  await tick();
  await a('POST','/charging/requests',{ vehicleId:'EV-03' },403);
});

test('A14 parking fixture triggers live alert hysteresis, acknowledgement and preserves real slots and hold', async t => {
  const { store, login } = await fixture(t,100);
  const op = await login('OPERATOR_A');
  const student = await login('STUDENT_A');
  const booking = (await student('POST','/reservations',{ vehicleId:'EV-01',destinationHubId:'H_METRO' })).data;
  const realSlots = store.snapshot().slots.filter(s=>s.hubId==='H_METRO' && s.vehicleId).map(s=>[s.id,s.vehicleId]);
  const fixtureInput = (occupied: number) => ({ kind:'parking-fixture',hubId:'H_METRO',occupied });
  const open = async () => (await op('GET','/operator/alerts?hubId=H_METRO&status=Open')).data;
  await student('POST','/operator/demo/events',fixtureInput(89),403);
  await op('POST','/operator/demo/events',fixtureInput(89));
  assert.equal((await open()).length,0);
  await op('POST','/operator/demo/events',fixtureInput(90));
  const [alert] = await open();
  assert.equal(alert.type,'PARKING');
  const ack = (await op('POST','/operator/alerts/'+alert.id+'/acknowledge',{version:alert.version})).data;
  assert.equal(ack.status,'Open');
  assert.equal(ack.acknowledgedAt,new Date(start).toISOString());
  await op('POST','/operator/demo/events',fixtureInput(85));
  assert.equal((await open())[0].id,alert.id);
  await op('POST','/operator/demo/events',fixtureInput(84));
  assert.equal((await open()).length,0);
  await op('POST','/operator/demo/events',fixtureInput(100),409);
  await op('POST','/operator/demo/events',fixtureInput(5),409);
  await op('POST','/operator/demo/events',fixtureInput(6));
  assert.deepEqual(store.snapshot().slots.filter(s=>s.hubId==='H_METRO' && s.vehicleId).map(s=>[s.id,s.vehicleId]),realSlots);
  assert.equal(store.snapshot().holds.find(h=>h.id===booking.hold.id)?.status,'Held');
  assert.equal(store.snapshot().slots.find(s=>s.id===booking.hold.slotId)?.vehicleId,null);
});

test('A04b: exactly one of 20 private parking requests can book the last compatible slot', async t => {
  const { store, login } = await fixture(t);
  await store.write({id:'OPERATOR_A',role:'OPERATOR'}, tx => {
    const slots = tx.state.slots.filter(s => s.hubId === 'H_METRO' && s.type === 'PRIVATE');
    for (const slot of slots.slice(1)) slot.blocked = true;
  });
  const a = await login('STUDENT_A');
  const b = await login('STUDENT_B');
  const responses = await Promise.all(Array.from({length:20}, (_, i) => {
    const [user, vehicle] = i % 2 ? [a,'PV_A'] as const : [b,'PV_B'] as const;
    return user('POST','/parking/bookings',parkingInput(vehicle,start+minute,start+61*minute),[200,409]);
  }));
  assert.equal(responses.filter(r=>r.data?.bookings?.length === 1).length,1);
  assert.equal(responses.filter(r=>r.error?.code === 'TIME_SLOT_CONFLICT').length,19);
  const snapshot = store.snapshot();
  assert.equal(snapshot.bookings.length,1);
  const [booking] = snapshot.bookings;
  const active = snapshot.holds.filter(h => h.status === 'Held' && h.slotId === booking.slotId);
  assert.deepEqual(active.map(h => h.id),[booking.holdId]);
});

test('A29: operator demo view and command table', async t => {
  const { store, login } = await fixture(t);
  const op = await login('OPERATOR_A');
  const view = await op('GET','/operator/demo/events');
  assert.equal(view.data.autoAck,true);
  assert.deepEqual(view.data.pausedHubs,[]);
  assert.equal(Array.isArray(view.data.commands),true);
  await op('POST','/operator/demo/events',{kind:'autoAck',enabled:false});
  assert.equal((await op('GET','/operator/demo/events')).data.autoAck,false);
});

test('A30: private parking booking expires — booking completes, hold releases', async t => {
  const { store, login, setNow, tick } = await fixture(t);
  const a = await login('STUDENT_A');
  const booking = (await a('POST','/parking/bookings',parkingInput('PV_A',start+10*minute,start+100*minute))).data.bookings[0];
  assert.equal((await a('GET','/me/parking-bookings')).data.length,1);
  assert.equal(store.snapshot().holds.find(h => h.id === booking.holdId)?.status,'Held');
  setNow(start+100*minute+1);
  await tick();
  assert.equal(store.snapshot().bookings.find(b => b.id === booking.id)?.status,'Completed');
  assert.equal(store.snapshot().holds.find(h => h.id === booking.holdId)?.status,'Released');
});

test('A31: arrive while the vehicle is parked elsewhere — booking marks Delayed', async t => {
  const { store, login } = await fixture(t);
  const a = await login('STUDENT_A');
  const booking = (await a('POST','/parking/bookings',parkingInput('PV_A',start,start+100*minute))).data.bookings[0];
  let elsewhere: string|undefined;
  await store.write({id:'OPERATOR_A',role:'OPERATOR'},(tx)=>{
    const slot = tx.state.slots.find(s => s.hubId==='H_METRO' && s.type==='PRIVATE' && s.id!==booking.slotId)!;
    elsewhere = slot.id;
    slot.vehicleId = 'PV_A';
  });
  await a('POST','/parking/bookings/'+booking.id+'/arrive',{version:booking.version});
  const row = store.snapshot().bookings.find(b => b.id === booking.id);
  assert.equal(row?.status,'Scheduled');
  assert.equal(row?.serviceStatus,'Delayed');
  assert.equal(row?.guarantee,'NotGuaranteed');
  assert.equal(store.snapshot().slots.find(s => s.id === booking.slotId)?.vehicleId,null);
  assert.equal(store.snapshot().slots.find(s => s.id === elsewhere)?.vehicleId,'PV_A');
});
