import { randomBytes, timingSafeEqual } from 'node:crypto';
import { arriveDestination, changeDestination, hubSummary, reassignBlockedDestination, releaseDestination, releaseOccupied,
  reserveDestination, transferDestination } from './m2.js';
import { checkVersion, entity, fail, fresh, owned, refreshAvailability, requiredString,
  type AddRoute, type Command, type Input, type Reservation, type State, type Trip, type Tx, type Vehicle } from './types.js';

function busyCharging(state: State, vehicleId: string): boolean {
  return state.points.some(p => p.pluggedVehicleId === vehicleId) ||
    state.sessions.some(s => s.vehicleId === vehicleId && ['Scheduled','Waiting','Starting','Charging','StopPending'].includes(s.status));
}

export function eligibility(vehicle: Vehicle, now: number, state?: State): string | null {
  if (state && busyCharging(state, vehicle.id)) return 'Xe đang cắm sạc hoặc có phiên sạc mở.';
  if (vehicle.healthStatus !== 'OK') return 'Xe đang lỗi hoặc bảo trì.';
  if (vehicle.allocationOwner || !['Available','NeedsCharge'].includes(vehicle.mobilityStatus) || !vehicle.hubId || !vehicle.slotId)
    return 'Xe hiện không sẵn sàng.';
  if (!fresh(vehicle, now)) return 'Dữ liệu pin chưa có hoặc đã cũ.';
  if ((vehicle.batteryPercent ?? 0) < 20 || vehicle.mobilityStatus !== 'Available') return 'Xe cần sạc trước khi đặt.';
  return null;
}

function reserve(tx: Tx, input: Input) {
  const vehicle = entity(tx.state.vehicles, requiredString(input, 'vehicleId'), 'xe');
  const reason = eligibility(vehicle, tx.now, tx.state);
  if (reason) fail(409, fresh(vehicle,tx.now) ? 'VEHICLE_UNAVAILABLE' : 'STALE_TELEMETRY', reason);
  if (tx.state.reservations.some((r) => r.userId === tx.actor.id && ['Reserved','UnlockPending'].includes(r.status)) ||
    tx.state.trips.some((t) => t.userId === tx.actor.id && t.endedAt === null))
    fail(409,'ACTIVE_BOOKING','Bạn đang có lượt đặt hoặc chuyến đi chưa kết thúc.');
  const hubId = requiredString(input, 'destinationHubId');
  const id = tx.id('RSV');
  const hold = reserveDestination(tx, hubId, 'SHARED_RESERVATION', id);
  const row: Reservation = {
    id, userId:tx.actor.id, vehicleId:vehicle.id, holdId:hold.id, token:randomBytes(5).toString('hex').toUpperCase(),
    expiresAt:tx.now+15*60_000,status:'Reserved',commandId:null,version:1,
  };
  vehicle.mobilityStatus = 'Reserved';
  vehicle.allocationOwner = {type:'SHARED_RESERVATION',id};
  ++vehicle.version;
  tx.state.reservations.push(row);
  tx.log('VEHICLE_RESERVED',vehicle.id,'Đã giữ xe và chỗ tại Hub đích.');
  return { ...row, hold };
}

function getReservation(tx: Tx, input: Input): Reservation {
  const row = entity(tx.state.reservations, requiredString(input,'id'), 'lượt đặt xe');
  owned(tx,row.userId);
  return row;
}

function getTrip(tx: Tx, input: Input): Trip {
  const row = entity(tx.state.trips, requiredString(input,'id'), 'chuyến đi');
  owned(tx,row.userId);
  return row;
}

function releaseReservation(tx: Tx, reservation: Reservation, status: 'Cancelled'|'Expired'): void {
  const vehicle = entity(tx.state.vehicles,reservation.vehicleId,'xe');
  if (vehicle.allocationOwner?.type !== 'SHARED_RESERVATION' || vehicle.allocationOwner.id !== reservation.id)
    fail(409,'INVALID_OWNER','Không còn quyền giữ xe.');
  releaseDestination(tx,reservation.holdId,'SHARED_RESERVATION',reservation.id);
  reservation.status = status;
  ++reservation.version;
  vehicle.allocationOwner = null;
  refreshAvailability(vehicle,tx.now);
  ++vehicle.version;
  tx.notify(reservation.userId,status === 'Expired' ? 'Lượt đặt xe đã hết hạn.' : 'Lượt đặt xe đã được hủy.');
}

export function expireReservations(tx: Tx): void {
  for (const row of tx.state.reservations) {
    if (row.status === 'Reserved' && row.expiresAt <= tx.now) releaseReservation(tx,row,'Expired');
  }
}

function tokenMatches(expected: string, received: string) {
  const a=Buffer.from(expected), b=Buffer.from(received.toUpperCase());
  return a.length===b.length && timingSafeEqual(a,b);
}

function pickup(tx: Tx, input: Input) {
  const row=getReservation(tx,input);
  checkVersion(input,row);
  if (row.status !== 'Reserved' || row.expiresAt <= tx.now) fail(409,'INVALID_TRANSITION','Lượt đặt không còn ở trạng thái có thể nhận xe.');
  if (!tokenMatches(row.token, requiredString(input,'token'))) fail(400,'INVALID_TOKEN','Mã nhận xe không khớp.');
  const vehicle=entity(tx.state.vehicles,row.vehicleId,'xe');
  if (vehicle.allocationOwner?.type !== 'SHARED_RESERVATION' || vehicle.allocationOwner.id !== row.id ||
    vehicle.mobilityStatus !== 'Reserved' || vehicle.healthStatus !== 'OK' || !vehicle.slotId || busyCharging(tx.state,vehicle.id) ||
    !fresh(vehicle,tx.now) || (vehicle.batteryPercent ?? 0) < 20)
    fail(409,'PICKUP_UNAVAILABLE','Xe hoặc dữ liệu xe không đáp ứng điều kiện nhận.');
  const command=tx.command('UNLOCK',vehicle.id,row.id);
  row.status='UnlockPending';
  row.commandId=command.id;
  ++row.version;
  vehicle.mobilityStatus='UnlockPending';
  ++vehicle.version;
  tx.log('UNLOCK_PENDING',vehicle.id,'Đã lưu lệnh mở khóa, đang chờ thiết bị.');
  return row;
}

export function applyUnlockAck(tx: Tx, command: Command, success: boolean): void {
  if (command.status !== 'Pending' || command.type !== 'UNLOCK' || command.dispatchedAt === null) return;
  const reservation=entity(tx.state.reservations,command.subjectId,'lượt đặt');
  if (reservation.status !== 'UnlockPending' || reservation.commandId !== command.id) return;
  const vehicle=entity(tx.state.vehicles,command.resourceId,'xe');
  if (vehicle.allocationOwner?.type !== 'SHARED_RESERVATION' || vehicle.allocationOwner.id !== reservation.id)
    fail(409,'INVALID_OWNER','Phản hồi thiết bị không khớp chủ giữ xe.');
  // For a negative result, the demo simulator certifies atomically that this command
  // never executed and is now disabled. Mere silence or a stale Locked observation is not an ACK.
  if (!success) {
    command.status='Failed';
    vehicle.healthStatus='Maintenance';
    releaseReservation(tx,reservation,'Cancelled');
    tx.log('UNLOCK_FAILED',vehicle.id,'Thiết bị xác nhận lệnh không thực thi và đã vô hiệu.');
    return;
  }
  const tripId=tx.id('TRIP');
  transferDestination(tx,reservation.holdId,'SHARED_RESERVATION',reservation.id,'TRIP',tripId);
  releaseSource(tx,vehicle);
  const trip: Trip={id:tripId,userId:reservation.userId,vehicleId:vehicle.id,holdId:reservation.holdId,
    startedAt:tx.now,endedAt:null,version:1};
  tx.state.trips.push(trip);
  reservation.status='Used';
  ++reservation.version;
  vehicle.allocationOwner={type:'TRIP',id:tripId};
  vehicle.mobilityStatus='InUse';
  ++vehicle.version;
  command.status='Confirmed';
  tx.notify(trip.userId,'Đã mở khóa. Chuyến đi bắt đầu.');
  tx.log('TRIP_STARTED',tripId,'Xác nhận mở khóa và bàn giao chỗ đích.');
}

function releaseSource(tx: Tx, v: Vehicle): void {
  if (!v.slotId) fail(409,'SLOT_EVIDENCE_REQUIRED','Không xác định được vị trí xuất phát của xe.');
  releaseOccupied(tx,v.slotId,v.id);
  v.slotId=null;
  v.hubId=null;
}

function finishTrip(tx: Tx, input: Input) {
  const trip=getTrip(tx,input);
  const invoice=tx.state.invoices.find((i) => i.tripId===trip.id);
  if (trip.endedAt !== null && invoice) return {...trip,invoice};
  checkVersion(input,trip);
  const vehicle=entity(tx.state.vehicles,trip.vehicleId,'xe');
  const hold=entity(tx.state.holds,trip.holdId,'chỗ đích');
  const hubId=requiredString(input,'hubId');
  const requestedSlotId=typeof input.slotId==='string' ? input.slotId : hold.slotId;
  if (hold.hubId!==hubId || hold.status!=='Held')
    fail(409,'WRONG_DESTINATION','Hub trả xe không khớp chỗ đang giữ.');
  if (vehicle.allocationOwner?.type !== 'TRIP' || vehicle.allocationOwner.id !== trip.id)
    fail(409,'INVALID_OWNER','Xe không thuộc chuyến đi này.');
  const evidence=tx.state.demo.physicalEvidence[vehicle.id];
  const verified=Boolean(evidence?.locked && evidence.hubId===hubId &&
    evidence.observedAt>=trip.startedAt && tx.now-evidence.observedAt<=60_000 && evidence.observedAt<=tx.now);
  const reserved=entity(tx.state.slots,hold.slotId,'chỗ đã giữ');
  const unavailable=reserved.blocked || reserved.vehicleId!==null;
  if (!unavailable && requestedSlotId!==hold.slotId)
    fail(409,'WRONG_DESTINATION','Chỗ trả xe không khớp chỗ đang giữ.');
  if (unavailable) {
    const verifiedSlotId=verified ? evidence?.slotId : undefined;
    if (requestedSlotId!==hold.slotId && requestedSlotId!==verifiedSlotId)
      fail(409,'WRONG_DESTINATION','Chỗ khác cần được thiết bị xác nhận.');
    const replacement=reassignBlockedDestination(tx,hold.id,'TRIP',trip.id,verifiedSlotId);
    if (!replacement) {
      const reason='Chỗ đã giữ không dùng được và chưa có chỗ thay thế hợp lệ. Operator cần xác nhận.';
      if (!tx.state.incidents.some(i=>i.resourceId===reserved.id && i.description.includes(trip.id) && i.status!=='Resolved')) {
        tx.state.incidents.push({id:tx.id('INC'),resourceType:'slot',resourceId:reserved.id,
          description:reason+' Chuyến '+trip.id,userId:trip.userId,status:'Reported',impacts:[],ticketId:null,version:1});
        tx.log('RETURN_NEEDS_OPERATOR',trip.id,reason);
      }
      return {...trip,returnPending:true,reason};
    }
  }
  if (!tx.state.demo.autoAck && (!verified || evidence!.slotId!==hold.slotId))
    fail(409,'DEVICE_PENDING','Cần xác nhận rằng xe đã vào đúng chỗ và đã khóa.');
  const slot=arriveDestination(tx,trip.holdId,'TRIP',trip.id,vehicle.id,hold.slotId);
  vehicle.hubId=slot.hubId;
  vehicle.slotId=slot.id;
  vehicle.allocationOwner=null;
  refreshAvailability(vehicle,tx.now,60);
  ++vehicle.version;
  trip.endedAt=tx.now;
  ++trip.version;
  delete tx.state.demo.physicalEvidence[vehicle.id];
  const result={id:tx.id('INV'),tripId:trip.id,userId:trip.userId,
    amountVnd:Math.max(1,Math.ceil((tx.now-trip.startedAt)/60_000))*1000,createdAt:tx.now};
  tx.state.invoices.push(result);
  tx.notify(trip.userId,'Đã trả xe và lưu hóa đơn mô phỏng.');
  tx.log('TRIP_ENDED',trip.id,'Đã xác nhận chỗ trả và lập hóa đơn.');
  return {...trip,invoice:result};
}

export function applyVehicleHealth(tx: Tx, vehicleId: string, health: Vehicle['healthStatus']): void {
  const v=entity(tx.state.vehicles,vehicleId,'xe');
  v.healthStatus=health;
  if (!v.allocationOwner && v.mobilityStatus!=='Charging') refreshAvailability(v,tx.now);
  ++v.version;
}

export function applyVehicleChargingState(tx: Tx, vehicleId: string, charging: boolean): void {
  const v=entity(tx.state.vehicles,vehicleId,'xe');
  if (v.allocationOwner) fail(409,'VEHICLE_ALLOCATED','Xe đã có chủ cấp phát.');
  if (charging) v.mobilityStatus='Charging';
  else refreshAvailability(v,tx.now,60);
  ++v.version;
}

export function applyReservationIncident(tx: Tx, vehicleId: string): string[] {
  const reservation=tx.state.reservations.find((r) => r.vehicleId===vehicleId && ['Reserved','UnlockPending'].includes(r.status));
  if (!reservation) return [];
  if (reservation.status==='UnlockPending') return ['Giữ lượt đặt và chỗ đích để đối soát mở khóa.'];
  const old=entity(tx.state.vehicles,vehicleId,'xe');
  const substitute=tx.state.vehicles.find((v) => v.id!==old.id && v.hubId===old.hubId && eligibility(v,tx.now,tx.state)===null);
  if (!substitute) {
    releaseReservation(tx,reservation,'Cancelled');
    return ['Đã hủy lượt đặt và nhả tài nguyên.'];
  }
  old.allocationOwner=null;
  refreshAvailability(old,tx.now);
  ++old.version;
  substitute.allocationOwner={type:'SHARED_RESERVATION',id:reservation.id};
  substitute.mobilityStatus='Reserved';
  ++substitute.version;
  reservation.vehicleId=substitute.id;
  ++reservation.version;
  tx.notify(reservation.userId,'Đã đổi sang xe '+substitute.id+' do sự cố.');
  return ['Đã chuyển lượt đặt sang xe '+substitute.id+'.'];
}

function itemVehicle(tx: Tx, vehicleId: string, itemId: string): Vehicle {
  const v=entity(tx.state.vehicles,vehicleId,'xe');
  if (v.allocationOwner?.type !== 'REDISTRIBUTION_ITEM' || v.allocationOwner.id !== itemId)
    fail(409,'INVALID_OWNER','Xe không do mục điều phối này giữ.');
  return v;
}
export function allocateVehicle(tx: Tx, vehicleId: string, itemId: string): void {
  const v=entity(tx.state.vehicles,vehicleId,'xe');
  const reason=eligibility(v,tx.now,tx.state);
  if (reason) fail(409,'VEHICLE_UNAVAILABLE',reason);
  v.allocationOwner={type:'REDISTRIBUTION_ITEM',id:itemId};
  ++v.version;
}
export function markVehicleInTransit(tx: Tx, vehicleId: string, itemId: string): void {
  const v=itemVehicle(tx,vehicleId,itemId);
  if (v.healthStatus!=='OK' || !fresh(v,tx.now) || busyCharging(tx.state,v.id)) fail(409,'VEHICLE_UNAVAILABLE','Xe chưa đủ điều kiện xuất phát.');
  releaseSource(tx,v);
  v.mobilityStatus='InTransit';
  ++v.version;
}
export function confirmVehicleArrival(tx: Tx, vehicleId: string, itemId: string, hubId: string, slotId: string): void {
  const v=itemVehicle(tx,vehicleId,itemId);
  v.hubId=hubId;
  v.slotId=slotId;
  v.allocationOwner=null;
  refreshAvailability(v,tx.now,60);
  ++v.version;
}
export function releaseVehicleHold(tx: Tx, vehicleId: string, itemId: string): void {
  const v=itemVehicle(tx,vehicleId,itemId);
  if (v.mobilityStatus==='InTransit') fail(409,'INVALID_TRANSITION','Cần xác nhận vị trí trước khi nhả xe đang điều phối.');
  v.allocationOwner=null;
  refreshAvailability(v,tx.now);
  ++v.version;
}

export function registerM1(add: AddRoute): void {
  const vehicleView=(tx: Tx,v: Vehicle) => {
    const reason=eligibility(v,tx.now,tx.state);
    const {allocationOwner,...pub}=v;
    return {...pub,eligible:!reason,reason,telemetryStatus:fresh(v,tx.now)?'Fresh':'Unknown'};
  };
  const publicHub=(tx: Tx, id: string) => {
    const {points,...summary}=hubSummary(tx.state,id,tx.now);
    if (tx.actor.role==='OPERATOR') return {...summary,points};
    return {...summary,points:points.map(({id,hubId,connectorType,ratedKW,blocked,occupancy}) => ({id,hubId,connectorType,ratedKW,blocked,occupancy}))};
  };
  add('GET','/hubs','ANY',(tx) => tx.state.hubs.map((h) => publicHub(tx,h.id)));
  add('GET','/hubs/:id','ANY',(tx,i) => publicHub(tx,requiredString(i,'id')));
  add('GET','/vehicles','ANY',(tx,i) => tx.state.vehicles.filter((v) =>
    (!i.hubId || v.hubId===i.hubId) && (!i.type || v.type===i.type)).map((v) => vehicleView(tx,v)));
  add('GET','/vehicles/:id','ANY',(tx,i) => vehicleView(tx,entity(tx.state.vehicles,requiredString(i,'id'),'xe')));
  add('GET','/me/reservations','STUDENT',(tx) => tx.state.reservations.filter((r) => r.userId===tx.actor.id)
    .map((r) => ({...r,hold:entity(tx.state.holds,r.holdId,'chỗ đích')})));
  add('GET','/me/trips','STUDENT',(tx) => tx.state.trips.filter((t) => t.userId===tx.actor.id)
    .map((t) => ({...t,hold:entity(tx.state.holds,t.holdId,'chỗ đích'),invoice:tx.state.invoices.find((i) => i.tripId===t.id)})));
  add('GET','/me/invoices','STUDENT',(tx) => tx.state.invoices.filter((i) => i.userId===tx.actor.id));
  add('GET','/me/notifications','ANY',(tx) => tx.state.notifications.filter((n) => n.userId===tx.actor.id).toReversed());
  add('POST','/reservations','STUDENT',reserve);
  add('POST','/reservations/:id/pickup','STUDENT',pickup);
  add('POST','/reservations/:id/cancel','STUDENT',(tx,i) => {
    const r=getReservation(tx,i); checkVersion(i,r);
    if (r.status!=='Reserved') fail(409,'INVALID_TRANSITION','Chỉ hủy lượt đặt chưa bắt đầu nhận xe.');
    releaseReservation(tx,r,'Cancelled');
    return r;
  });
  add('POST','/reservations/:id/change-destination','STUDENT',(tx,i) => {
    const r=getReservation(tx,i); checkVersion(i,r);
    if (r.status!=='Reserved' || r.expiresAt<=tx.now) fail(409,'INVALID_TRANSITION','Lượt đặt không thể đổi đích.');
    const hold=changeDestination(tx,r.holdId,requiredString(i,'newHubId'),'SHARED_RESERVATION',r.id);
    r.holdId=hold.id;
    ++r.version;
    return {...r,hold};
  });
  add('POST','/trips/:id/change-destination','STUDENT',(tx,i) => {
    const trip=getTrip(tx,i); checkVersion(i,trip);
    if (trip.endedAt!==null) fail(409,'INVALID_TRANSITION','Chuyến đã kết thúc.');
    const hold=changeDestination(tx,trip.holdId,requiredString(i,'newHubId'),'TRIP',trip.id);
    trip.holdId=hold.id;
    ++trip.version;
    return {...trip,hold};
  });
  add('POST','/trips/:id/return','STUDENT',finishTrip);
}
