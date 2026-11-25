import type { HubView } from './client';
import { DateTime } from './ui';
import normal from './assets/hub-normal.svg';
import atRisk from './assets/hub-at-risk.svg';
import overloaded from './assets/hub-overloaded.svg';
import offline from './assets/hub-offline.svg';

const conditions = {
  normal: { label: 'Bình thường', icon: normal },
  risk: { label: 'Gần đầy', icon: atRisk },
  overloaded: { label: 'Quá tải', icon: overloaded },
  offline: { label: 'Mất cập nhật', icon: offline },
} as const;

export function hubCondition(hub: HubView): keyof typeof conditions {
  if (hub.stale || hub.parkingOccupancyPct === null) return 'offline';
  if (hub.parkingOccupancyPct >= 90) return 'overloaded';
  return hub.parkingOccupancyPct >= 70 ? 'risk' : 'normal';
}

export function HubStatus({ hub }: { hub: HubView }) {
  const status = hubCondition(hub);
  return <span className="hub-status" data-condition={status}><img src={conditions[status].icon} alt="" />{conditions[status].label}</span>;
}

export function CapacityMeter({ label, used, capacity }: { label: string; used: number | null; capacity: number }) {
  const percent = used === null || !capacity ? null : Math.min(100, Math.round(used / capacity * 100));
  return <div className="capacity">
    <div className="row between"><span>{label}</span><strong>{used === null ? '—' : `${used.toLocaleString('vi-VN')}/${capacity}`}{percent !== null ? ` · ${percent}%` : ''}</strong></div>
    <div className="meter capacity-meter" data-condition={percent === null ? 'offline' : percent >= 90 ? 'overloaded' : percent >= 70 ? 'risk' : 'normal'} aria-hidden="true">
      <span style={{ width: `${percent ?? 0}%` }} />
    </div>
  </div>;
}

export function NetworkMap({ hubs, selected, onSelect }: { hubs: HubView[]; selected: string; onSelect: (id: string) => void }) {
  const positions = [[19,55],[47,25],[77,63]];
  const nodes = hubs.map((hub, index) => {
    const [x,y] = positions[index] ?? [15 + (index % 4) * 23, 81];
    return {hub,x,y};
  });
  const updated = Math.max(0, ...hubs.map(hub => hub.lastSeenAt ?? 0));
  return <section className="network-map" aria-label="Bản đồ mạng lưới Hub">
    <div className="map-heading"><h2>Bản đồ mạng lưới Hub</h2><p className="small muted">Số trong vòng là số xe khả dụng</p></div>
    <div className="map-filters" role="group" aria-label="Lọc xe theo hub">
      <button type="button" className="pill" aria-pressed={!selected} onClick={() => onSelect('')}>Tất cả hub</button>
      {hubs.map(hub => <button type="button" key={hub.id} className="pill" aria-pressed={hub.id === selected} onClick={() => onSelect(hub.id)}>{hub.name}</button>)}
    </div>
    {nodes.length ? <div className="map-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="map-edges" aria-hidden="true">
        {nodes.slice(1).map(({hub,x,y}, i) => <line key={hub.id} x1={nodes[i].x} y1={nodes[i].y} x2={x} y2={y} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {nodes.map(({hub,x,y}) => {
        const status = hubCondition(hub);
        return <button key={hub.id} type="button" className="map-node" style={{left:`${x}%`,top:`${y}%`}}
          aria-label={`${hub.name}, ${hub.stale ? 'mất cập nhật' : `${hub.availableVehicles} xe khả dụng`}`}
          aria-pressed={selected === hub.id} data-condition={status} onClick={() => onSelect(hub.id)}>
          <span className="map-count">{hub.stale ? '–' : hub.availableVehicles}<img src={conditions[status].icon} alt="" /></span>
          <span className="map-name">{hub.name}</span>
        </button>;
      })}
    </div> : <p className="map-empty muted">Chưa có dữ liệu Hub.</p>}
    <div className="map-footer small muted">
      <div className="map-legend">{Object.values(conditions).map(({label,icon}) => <span key={label}><img src={icon} alt="" />{label}</span>)}</div>
      {updated > 0 && <span>Cập nhật <DateTime value={updated} /></span>}
    </div>
  </section>;
}
