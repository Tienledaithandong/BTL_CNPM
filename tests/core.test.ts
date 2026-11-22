import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/api/app.js';
import { Store, type SaveStage } from '../src/api/store.js';
import type { Hold, Reservation, Trip } from '../src/api/types.js';

async function environment(t: TestContext, fault?: (stage: SaveStage) => void) {
  const directory=await mkdtemp(join(tmpdir(),'mobility-'));
  let now=Date.UTC(2026,10,18,3,0);
  const env=await createApp({directory,background:false,clock:()=>now,fault});
  const {app}=env;
  t.after(async () => { await app.close(); await rm(directory,{recursive:true,force:true}); });
  const login=async (userId:string) => {
    const r=await app.inject({method:'POST',url:'/api/auth/login',payload:{userId,password:'demo'}});
    assert.equal(r.statusCode,200,r.body);
    return String(r.headers['set-cookie']).split(';')[0];
  };
  const [student,other,operator]=await Promise.all([login('STUDENT_A'),login('STUDENT_B'),login('OPERATOR_A')]);
  const get=(cookie:string,path:string) => app.inject({method:'GET',url:'/api'+path,headers:{cookie}});
  const post=(cookie:string,path:string,payload:object,id:string=randomUUID()) => app.inject({
    method:'POST',url:'/api'+path,headers:{cookie,'idempotency-key':id},payload,
  });
  return {...env,directory,student,other,operator,get,post,advance:(ms:number) => { now+=ms; }};
}
const reservePayload={vehicleId:'EV-01',destinationHubId:'H_KTX'};
const demo='/operator/demo/events';

test('A01/A02/A04a/A25: owner and role boundaries, simultaneous booking and exact retry',async (t) => {
  const e=await environment(t);
  assert.equal((await e.get('','/hubs')).statusCode,401);
  assert.equal((await e.get(e.student,'/operator/overview')).statusCode,403);
  assert.equal((await e.post(e.other,'/reservations',{vehicleId:'EV-04',destinationHubId:'H_KTX'})).statusCode,409);
  const responses=await Promise.all(Array.from({length:20},(_,i)=>
    e.post(i%2?e.other:e.student,'/reservations',reservePayload)));
  const successes=responses.filter((r)=>r.statusCode===200);
  assert.equal(successes.length,1,responses.map(r=>r.statusCode).join(','));
  const winner=successes[0].json<{data:Reservation;requestId:string}>();
  assert.equal(e.store.snapshot().holds.length,1);
  const owner=winner.data.userId==='STUDENT_A'?e.student:e.other;
  const nonowner=owner===e.student?e.other:e.student;
  assert.deepEqual((await e.get(nonowner,'/me/reservations')).json().data,[]);
  assert.equal((await e.post(nonowner,'/reservations/'+winner.data.id+'/cancel',{expectedVersion:1})).statusCode,403);
  const retried=await e.post(owner,'/reservations',reservePayload,winner.requestId);
  assert.deepEqual(retried.json().data,winner.data);
  const conflict=await e.post(owner,'/reservations',{...reservePayload,destinationHubId:'H_BK'},winner.requestId);
  assert.equal(conflict.statusCode,409);
  assert.equal(conflict.json().error.code,'IDEMPOTENCY_CONFLICT');
});

test('A03/A05: failure for full destination keeps old hold and does not allocate another vehicle',async(t)=>{
  const e=await environment(t);
  await e.store.system((tx)=>{
    for (const slot of tx.state.slots.filter(s=>s.hubId==='H_BK' && s.type==='SHARED')) slot.blocked=true;
  });
  const invalid=await e.post(e.other,'/reservations',{vehicleId:'EV-02',destinationHubId:'H_BK'});
  assert.equal(invalid.statusCode,409,invalid.body);
  assert.equal(e.store.snapshot().vehicles.find(v=>v.id==='EV-02')?.allocationOwner,null);
  const reserved=await e.post(e.student,'/reservations',reservePayload);
  assert.equal(reserved.statusCode,200,reserved.body);
  const row=reserved.json<{data:Reservation & {hold:Hold}}>().data;
  const changed=await e.post(e.student,'/reservations/'+row.id+'/change-destination',{newHubId:'H_BK',expectedVersion:row.version});
  assert.equal(changed.statusCode,409,changed.body);
  assert.equal(e.store.snapshot().holds.find(h=>h.id===row.holdId)?.status,'Held');
});

test('A06/A07/A08: late ACK, source slot and destination ownership, invalid return, one invoice',async (t)=>{
  const e=await environment(t);
  assert.equal((await e.post(e.operator,demo,{kind:'autoAck',enabled:false})).statusCode,200);
  const start=await e.post(e.student,'/reservations',reservePayload);
  assert.equal(start.statusCode,200,start.body);
  const res=start.json<{data:Reservation & {hold:Hold}}>().data;
  const picked=await e.post(e.student,'/reservations/'+res.id+'/pickup',{token:res.token,expectedVersion:res.version});
  assert.equal(picked.statusCode,200,picked.body);
  const pending=picked.json<{data:Reservation}>().data;
  await e.tick();
  e.advance(16*60_000);
  await e.tick();
  assert.equal(e.store.snapshot().reservations[0].status,'UnlockPending');
  assert.equal(e.store.snapshot().trips.length,0);
  assert.ok(e.store.snapshot().slots.some(s=>s.vehicleId==='EV-01'));
  const ack={kind:'ack',commandId:pending.commandId,success:true};
  assert.equal((await e.post(e.operator,demo,ack)).statusCode,200);
  assert.equal((await e.post(e.operator,demo,ack)).statusCode,200);
  assert.equal(e.store.snapshot().trips.length,1);
  const {data:[trip]}=(await e.get(e.student,'/me/trips')).json<{data:(Trip&{hold:Hold})[]}>();
  assert.equal(trip.hold.ownerId,trip.id);
  assert.equal(e.store.snapshot().slots.find(s=>s.vehicleId==='EV-01'),undefined);
  const returned='/trips/'+trip.id+'/return';
  const wrong=await e.post(e.student,returned,{hubId:'H_BK',expectedVersion:trip.version});
  assert.equal(wrong.statusCode,409);
  const noEvidence=await e.post(e.student,returned,{hubId:'H_KTX',expectedVersion:trip.version});
  assert.equal(noEvidence.json().error.code,'DEVICE_PENDING');
  assert.equal((await e.post(e.operator,demo,{kind:'returnEvidence',vehicleId:'EV-01',hubId:'H_KTX',slotId:trip.hold.slotId})).statusCode,200);
  for (let attempt=0;attempt<2;attempt++) {
    const result=await e.post(e.student,returned,{hubId:'H_KTX',expectedVersion:trip.version});
    assert.equal(result.statusCode,200,result.body);
  }
  assert.equal(e.store.snapshot().invoices.length,1);
  assert.equal(e.store.snapshot().slots.find(s=>s.id===trip.hold.slotId)?.vehicleId,'EV-01');
});

test('A06: expired reservation releases both vehicle and destination',async(t)=>{
  const e=await environment(t);
  assert.equal((await e.post(e.student,'/reservations',reservePayload)).statusCode,200);
  e.advance(15*60_000);
  await e.tick();
  const state=e.store.snapshot();
  assert.equal(state.reservations[0].status,'Expired');
  assert.equal(state.holds[0].status,'Released');
  assert.equal(state.vehicles[0].allocationOwner,null);
});

test('A22/A24: snapshot write failure, ambiguous replace, backup recovery and unreadable copies',async(t)=>{
  let stage:SaveStage|undefined;
  const e=await environment(t,(s)=>{if(s===stage) throw new Error('fixture fault');});
  stage='before-replace';
  const failed=await e.post(e.student,'/reservations',reservePayload);
  assert.equal(failed.statusCode,503);
  assert.equal(failed.json().error.code,'SNAPSHOT_WRITE_FAILED');
  assert.equal(e.store.snapshot().reservations.length,0);
  let notifications=0;
  e.store.subscribe(()=>{++notifications;});
  stage='replace-reported-error';
  const uncertain=await e.post(e.student,'/reservations',reservePayload);
  assert.equal(uncertain.json().error.code,'COMMIT_UNCERTAIN');
  assert.equal(notifications,0);
  assert.match(e.store.recoveryReason ?? '',/đối soát/);
  const main=await readFile(join(e.directory,'snapshot.json'),'utf8');
  assert.equal(JSON.parse(main).state.reservations.length,1);
  await writeFile(join(e.directory,'snapshot.json'),'corrupt');
  const recovered=await Store.open(e.directory);
  assert.match(recovered.recoveryReason ?? '',/dự phòng/);
  const op={id:'OPERATOR_A',role:'OPERATOR'} as const;
  await assert.rejects(recovered.write(op,(tx)=>tx.log('x','y','z')),/đối soát/);
  await recovered.recover(op);
  assert.equal(recovered.recoveryReason,null);
  await writeFile(join(e.directory,'snapshot.json'),'corrupt');
  await writeFile(join(e.directory,'snapshot.prev.json'),'corrupt');
  await assert.rejects(Store.open(e.directory),/Không nạp được snapshot/);
});

test('A23: persisted command survives restart and ACK application is durable',async(t)=>{
  const e=await environment(t);
  const reserved=(await e.post(e.student,'/reservations',reservePayload)).json<{data:Reservation}>().data;
  const picked=await e.post(e.student,'/reservations/'+reserved.id+'/pickup',{token:reserved.token,expectedVersion:reserved.version});
  assert.equal(picked.statusCode,200,picked.body);
  const commandId=picked.json<{data:Reservation}>().data.commandId;
  const after=await createApp({directory:e.directory,background:false,clock:e.store.clock});
  try {
    assert.equal(after.store.snapshot().commands[0].id,commandId);
    assert.equal(after.store.snapshot().commands[0].dispatchedAt,null);
    await after.tick();
    await after.tick();
    assert.equal(after.store.snapshot().commands[0].id,commandId);
    assert.equal(after.store.snapshot().commands[0].attempts,1);
    assert.equal(after.store.snapshot().trips.length,1);
  } finally {await after.app.close();}
});

test('A23/A24: backup commands require explicit reconciliation even after a second restart',async t=>{
  const e=await environment(t);
  const reserved=(await e.post(e.student,'/reservations',reservePayload)).json<{data:Reservation}>().data;
  const picked=await e.post(e.student,'/reservations/'+reserved.id+'/pickup',{token:reserved.token,version:reserved.version});
  const unlockId=picked.json().data.commandId;
  const charge=await e.post(e.operator,'/charging/requests',{vehicleId:'EV-03',target:80});
  assert.equal(charge.statusCode,200,charge.body);
  await e.store.system(tx => {
    const dispatched=tx.state.commands.find(command => command.type==='CHARGE_START')!;
    dispatched.dispatchedAt=tx.now;
  });
  await e.store.system(tx => tx.log('TEST_CHECKPOINT','snapshot','Rotate backup'));
  await writeFile(join(e.directory,'snapshot.json'),'corrupt');
  let system=await createApp({directory:e.directory,background:false,clock:e.store.clock});
  t.after(async () => { await system.app.close(); });
  async function operatorCookie() {
    const response=await system.app.inject({method:'POST',url:'/api/auth/login',payload:{userId:'OPERATOR_A',password:'demo'}});
    return String(response.headers['set-cookie']).split(';')[0];
  }
  let cookie=await operatorCookie();
  const event=(payload:object,key=randomUUID()) => system.app.inject({
    method:'POST',url:'/api'+demo,headers:{cookie,'idempotency-key':key},payload,
  });
  const backup=system.store.snapshot();
  await system.tick();
  assert.deepEqual(system.store.snapshot(),backup);
  assert.equal((await event({kind:'recover',confirm:true})).json().error.code,'DEVICE_PENDING');
  assert.equal((await event({kind:'ack',commandId:unlockId,success:true})).json().error.code,'RECOVERY');
  const payload={kind:'reconcile-command',commandId:unlockId,success:true,confirm:true};
  const key=randomUUID();
  const reconciled=await event(payload,key);
  assert.equal(reconciled.statusCode,200,reconciled.body);
  assert.equal(reconciled.json().data.dispatchedAt,null);
  assert.equal(system.store.snapshot().trips.length,1);
  await system.app.close();
  system=await createApp({directory:e.directory,background:false,clock:e.store.clock});
  cookie=await operatorCookie();
  assert.match(system.store.recoveryReason ?? '',/phiên bản/);
  await system.tick();
  assert.equal(system.store.snapshot().commands[1].status,'Pending');
  assert.deepEqual((await event(payload,key)).json(),reconciled.json());
  assert.equal(system.store.snapshot().trips.length,1);
  const commandId=system.store.snapshot().commands[1].id;
  assert.equal((await event({kind:'reconcile-command',commandId,success:true,confirm:true})).statusCode,200);
  assert.equal(system.store.snapshot().sessions[0].status,'Charging');
  assert.equal((await event({kind:'recover',confirm:true})).statusCode,200);
  assert.equal(system.store.recoveryReason,null);
});

test('A02: telemetry ordering and stale or faulty vehicles are reflected by the Student read model and guards',async t=>{
  const e=await environment(t);
  const payload={kind:'battery',vehicleId:'EV-01',batteryPercent:80,sequence:10,observedAt:new Date(e.store.clock()).toISOString()};
  assert.equal((await e.post(e.operator,demo,payload)).json().data.sequence,10);
  assert.equal((await e.post(e.operator,demo,{...payload,batteryPercent:10})).json().data.reason,'SEQUENCE_NOT_NEWER');
  const older={...payload,sequence:11,observedAt:new Date(e.store.clock()-1000).toISOString()};
  assert.equal((await e.post(e.operator,demo,older)).json().data.reason,'OBSERVATION_OLDER');
  const view=(await e.get(e.student,'/vehicles/EV-01')).json().data;
  assert.equal(view.batteryPercent,80);
  assert.equal(view.observedAt,payload.observedAt);
  const r=(await e.post(e.student,'/reservations',reservePayload)).json().data;
  e.advance(60_001);
  const stale=(await e.get(e.student,'/vehicles/EV-01')).json().data;
  assert.equal(stale.telemetryStatus,'Unknown');
  assert.equal(stale.canReserve,false);
  assert.equal((await e.post(e.other,'/reservations',{...reservePayload,vehicleId:'EV-02'})).json().error.code,'STALE_TELEMETRY');
  const pickup=(await e.get(e.student,'/me/reservations')).json().data[0];
  assert.equal(pickup.canPickup,false);
  assert.match(pickup.pickupReason,/đã cũ/);
  assert.equal((await e.post(e.student,'/reservations/'+r.id+'/pickup',{token:r.token,version:r.version})).json().error.code,'PICKUP_UNAVAILABLE');
  await e.store.system(tx => { tx.state.vehicles.find(v => v.id==='EV-01')!.healthStatus='Faulty'; });
  await e.post(e.operator,demo,{kind:'battery',vehicleId:'EV-01',batteryPercent:90});
  assert.match((await e.get(e.student,'/me/reservations')).json().data[0].pickupReason,/lỗi/);
  assert.equal(e.store.snapshot().activity.filter(event => event.type==='TELEMETRY_IGNORED').length,2);
});

test('Snapshot v1 opens with epoch dates and retains state when converted to v2 UTC',async t=>{
  const e=await environment(t);
  const first=await e.post(e.student,'/reservations',reservePayload,'v1-fixture');
  const legacy=e.store.snapshot();
  const checksum=createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
  const path=join(e.directory,'snapshot.json');
  await writeFile(path,JSON.stringify({schemaVersion:1,checksum,state:legacy}));
  const reopened=await Store.open(e.directory,e.store.clock);
  assert.deepEqual(reopened.snapshot(),legacy);
  await reopened.system(tx => tx.log('MIGRATION_CHECK','snapshot','Commit v2'));
  const disk=JSON.parse(await readFile(path,'utf8'));
  assert.equal(disk.schemaVersion,2);
  assert.equal(disk.state.reservations[0].expiresAt,first.json().data.expiresAt);
  assert.equal(disk.state.holds[0].endAt,null);
  assert.deepEqual((await Store.open(e.directory,e.store.clock)).snapshot(),reopened.snapshot());
});

test('A26/Q06-Q07: WebSocket authorization, redacted invalidation and state after reconnect', {timeout:8000}, async(t)=>{
  const e=await environment(t);
  const address=await e.app.listen({host:'127.0.0.1',port:0});
  const socketUrl=address.replace('http:','ws:')+'/ws';
  const failedHandshake=new WebSocket(socketUrl);
  await once(failedHandshake,'error');
  const subscribed=(cookie:string) => new WebSocket(socketUrl,{headers:{Cookie:cookie}});
  const first=subscribed(e.other);
  try {
    const [hello]=await once(first,'message');
    const initial=JSON.parse(String(hello));
    assert.equal(initial.type,'state.changed');
    const next=once(first,'message');
    await e.post(e.student,'/reservations',reservePayload);
    const [frame]=await next;
    const update=JSON.parse(String(frame));
    assert.deepEqual(Object.keys(update).sort(),['entityRef','eventId','occurredAt','stateVersion','type']);
    assert.equal(update.entityRef,null);
    assert.notEqual(update.eventId,initial.eventId);
    assert.equal(update.occurredAt,new Date(e.store.clock()).toISOString());
    assert.ok(update.stateVersion>initial.stateVersion);
  } finally {first.close(); await once(first,'close');}
  const offscreen=await e.post(e.operator,demo,{kind:'battery',vehicleId:'EV-02',batteryPercent:18});
  assert.equal(offscreen.statusCode,200);
  const second=subscribed(e.other);
  try {
    const [hello]=await once(second,'message');
    assert.equal(JSON.parse(String(hello)).stateVersion,e.store.version);
    const refreshed=await e.get(e.other,'/vehicles/EV-02');
    assert.equal(refreshed.json().data.batteryPercent,18);
    assert.deepEqual((await e.get(e.other,'/me/reservations')).json().data,[]);
  } finally {second.close();await once(second,'close');}
});

test('UC06: unavailable return slot is repaired atomically or escalated without closing the trip',async(t)=>{
  const e=await environment(t);
  const reserved=(await e.post(e.student,'/reservations',reservePayload)).json<{data:Reservation}>().data;
  assert.equal((await e.post(e.student,'/reservations/'+reserved.id+'/pickup',{token:reserved.token,expectedVersion:1})).statusCode,200);
  await e.tick();
  const {data:[trip]}=(await e.get(e.student,'/me/trips')).json<{data:(Trip&{hold:Hold})[]}>();
  const path='/trips/'+trip.id+'/return';
  await e.store.system((tx)=>{
    for(const slot of tx.state.slots) if(slot.hubId==='H_KTX' && slot.type==='SHARED') slot.blocked=true;
  });
  const pending=await e.post(e.student,path,{hubId:'H_KTX',expectedVersion:trip.version});
  assert.equal(pending.statusCode,200,pending.body);
  assert.equal(pending.json().data.returnPending,true);
  assert.equal(e.store.snapshot().invoices.length,0);
  assert.equal(e.store.snapshot().incidents.length,1);
  const alternative=await e.store.system((tx)=>{
    const slot=tx.state.slots.find(s=>s.hubId==='H_KTX' && s.type==='SHARED' && !s.vehicleId && s.id!==trip.hold.slotId)!;
    slot.blocked=false;
    return slot.id;
  });
  const returned=await e.post(e.student,path,{hubId:'H_KTX',expectedVersion:trip.version});
  assert.equal(returned.statusCode,200,returned.body);
  assert.equal(e.store.snapshot().invoices.length,1);
  assert.equal(e.store.snapshot().vehicles[0].slotId,alternative.data);
});

test('A28: trip destination changes mid-trip; students report incidents on their trips', async (t) => {
  const e=await environment(t);
  const reserved=(await e.post(e.student,'/reservations',reservePayload)).json<{data:Reservation}>().data;
  const picked=await e.post(e.student,'/reservations/'+reserved.id+'/pickup',{token:reserved.token,expectedVersion:reserved.version});
  assert.equal(picked.statusCode,200,picked.body);
  await e.tick();
  await e.tick();
  const {data:[trip]}=(await e.get(e.student,'/me/trips')).json<{data:(Trip&{hold:Hold})[]}>();
  assert.equal(trip.endedAt,null);
  assert.equal((await e.post(e.other,'/trips/'+trip.id+'/change-destination',{newHubId:'H_BK',expectedVersion:trip.version})).statusCode,403);
  const changed=await e.post(e.student,'/trips/'+trip.id+'/change-destination',{newHubId:'H_BK',expectedVersion:trip.version});
  assert.equal(changed.statusCode,200,changed.body);
  const data=changed.json().data;
  assert.equal(data.hold.hubId,'H_BK');
  assert.equal(data.hold.status,'Held');
  assert.equal(data.version,trip.version+1);
  assert.equal((await e.get(e.student,'/me/trips')).json().data[0].hold.hubId,'H_BK');
  assert.equal((await e.post(e.student,'/trips/'+trip.id+'/change-destination',{newHubId:'H_METRO',expectedVersion:trip.version})).statusCode,409);
  const incident=await e.post(e.student,'/incidents',{resourceType:'vehicle',resourceId:trip.vehicleId,tripId:trip.id,description:'Kiểm tra bánh xe'});
  assert.equal(incident.statusCode,200,incident.body);
  assert.equal((await e.post(e.other,'/incidents',{resourceType:'vehicle',resourceId:trip.vehicleId,tripId:trip.id,description:'Mục tiêu khác'})).statusCode,403);
});

test('A29: student read routes for hubs/:id, private vehicles, invoices and notifications', async (t) => {
  const e=await environment(t);
  assert.deepEqual((await e.get(e.student,'/me/private-vehicles')).json().data.map((v:{id:string})=>v.id),['PV_A']);
  assert.deepEqual((await e.get(e.other,'/me/private-vehicles')).json().data.map((v:{id:string})=>v.id),['PV_B']);
  const metro=(await e.get(e.student,'/hubs/H_METRO')).json().data;
  assert.equal(metro.id,'H_METRO');
  assert.equal(metro.stale,false);
  const first=(await e.post(e.student,'/reservations',reservePayload)).json<{data:Reservation}>().data;
  assert.ok(first.id);
  e.advance(15*60_000);
  await e.tick();
  assert.equal(e.store.snapshot().reservations[0].status,'Expired');
  assert.ok((await e.get(e.student,'/me/notifications')).json().data.some((n:{message:string})=>n.message==='Lượt đặt xe đã hết hạn.'));
  // Dữ liệu pin đã cũ sau advance — giả lập telemetry mới để đặt lại được.
  assert.equal((await e.post(e.operator,'/operator/demo/events',{kind:'battery',vehicleId:'EV-01',batteryPercent:90})).statusCode,200);
  const reserved=(await e.post(e.student,'/reservations',reservePayload)).json<{data:Reservation}>().data;
  const picked=await e.post(e.student,'/reservations/'+reserved.id+'/pickup',{token:reserved.token,expectedVersion:reserved.version});
  assert.equal(picked.statusCode,200,picked.body);
  await e.tick();
  await e.tick();
  const {data:[trip]}=(await e.get(e.student,'/me/trips')).json<{data:(Trip&{hold:Hold})[]}>();
  await e.post(e.operator,'/operator/demo/events',{kind:'returnEvidence',vehicleId:reserved.vehicleId,hubId:'H_KTX',slotId:trip.hold.slotId});
  assert.equal((await e.post(e.student,'/trips/'+trip.id+'/return',{hubId:'H_KTX',expectedVersion:trip.version})).statusCode,200);
  assert.equal((await e.get(e.student,'/me/invoices')).json().data.length,1);
  assert.deepEqual((await e.get(e.student,'/me/charging-sessions')).json().data,[]);
});
