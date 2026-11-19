import type { Hub, State } from './types.js';
import seedTemplate from './seed.json' with { type: 'json' };

const hubs: Hub[] = [
  { id: 'H_METRO', name: 'Ga Metro', location: { lat: 10.8758, lng: 106.8042 }, powerLimitKW: 3, lastSeenAt: null },
  { id: 'H_KTX', name: 'Ký túc xá', location: { lat: 10.8786, lng: 106.8031 }, powerLimitKW: 3, lastSeenAt: null },
  { id: 'H_BK', name: 'Bách Khoa', location: { lat: 10.8803, lng: 106.8053 }, powerLimitKW: 3, lastSeenAt: null },
];

export function createSeed(now: number, slotsPerHub = 15): State {
  if (slotsPerHub===15) {
    const seed=structuredClone(seedTemplate) as State;
    for (const hub of seed.hubs) hub.lastSeenAt=now;
    for (const vehicle of seed.vehicles) if (vehicle.observedAt!==null) vehicle.observedAt=now;
    return seed;
  }
  const hubRows = hubs.map((hub) => ({ ...hub, lastSeenAt: now }));
  const slots: State['slots'] = [];
  const vehicles: State['vehicles'] = [];
  const points: State['points'] = [];
  const counts = [6, 4, 2];
  for (const [i, hub] of hubRows.entries()) {
    const sharedCount = slotsPerHub === 15 ? 10 : Math.max(10, slotsPerHub - 5);
    for (let j = 1; j <= sharedCount + 5; ++j) {
      const slotId = hub.id + '-S' + String(j).padStart(2, '0');
      const vehicleId = j <= counts[i] ? 'EV-' + String(vehicles.length + 1).padStart(2, '0') : null;
      slots.push({id:slotId, hubId:hub.id, type:j <= sharedCount ? 'SHARED' : 'PRIVATE', vehicleId, blocked:false});
      if (vehicleId) {
        const batteryPercent = [90, 65, 25, 15][(j - 1) % 4];
        vehicles.push({ id:vehicleId, type:j % 2 ? 'Xe đạp điện' : 'Xe máy điện',
          hubId:hub.id, slotId, batteryPercent, observedAt:now, sequence:0, healthStatus:'OK',
          mobilityStatus:batteryPercent >= 20 ? 'Available' : 'NeedsCharge', allocationOwner:null, connectorType:'TYPE2', capacityKWh:4, version:1 });
      }
    }
    for (let j=1; j<=2; ++j)
      points.push({id:hub.id+'-C'+j, hubId:hub.id, connectorType:'TYPE2', ratedKW:2, blocked:false, pluggedVehicleId:null, powered:false});
  }
  return {
    version:0, hubs:hubRows, vehicles, slots, points, holds:[],
    privateVehicles:[
      {id:'PV_A',userId:'STUDENT_A',plate:'59-EA 000.01',capacityKWh:4,connectorType:'TYPE2'},
      {id:'PV_B',userId:'STUDENT_B',plate:'59-EB 000.02',capacityKWh:4,connectorType:'TYPE2'}
    ],
    reservations:[],trips:[],invoices:[],chargingRequests:[],bookings:[],sessions:[],
    alerts:[],incidents:[],orders:[],plans:[],scenarios:[],runs:[],commands:[],
    notifications:[],activity:[],idempotency:{},
    demo:{autoAck:true,pausedHubs:[],physicalEvidence:{}},
  };
}
