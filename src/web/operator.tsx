import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Alert, ChargingPlan, Command, Incident, Order, Point, Run, Scenario, ScenarioConfig, Slot } from '../api/types';
import type { HubView, VehicleView } from './client';
import { mutate, useAction, useResource } from './client';
import { Badge, Card, Circuit, DateTime, Empty, Field, Icon, Stat } from './ui';
import { Button, DataTable, Feedback, HubField, ResourceStatus, hubName } from './components';

export type OperatorPage = 'overview' | 'alerts' | 'incidents' | 'redistribution' | 'plans' | 'scenarios' | 'demo';
type PageProps = { revision: number; refresh: () => void };
const submit = (event: FormEvent<HTMLFormElement>, action: () => void) => { event.preventDefault(); action(); };

type HubOverview = Omit<HubView, 'points'> & {
  occupiedSlots: number; totalSlots: number; parkingOccupancyPct: number | null; powerInUseKW: number; stale: boolean;
  openAlerts: number; slots: Slot[]; points: Array<Point & { occupancy: string; activeSessionId: string | null }>;
};
type Overview = { hubs: HubOverview[]; totals: Partial<Omit<HubOverview, keyof HubView | 'points'>> & Partial<Pick<HubView,'availableVehicles'|'availableSlots'|'availablePoints'>> };
const sum = (hubs: HubOverview[], key: 'availableVehicles' | 'availableSlots' | 'availablePoints' | 'openAlerts' | 'occupiedSlots' | 'totalSlots') => hubs.reduce((total, hub) => total + (hub[key] ?? 0), 0);

export function OperatorOverview({ revision }: PageProps) {
  const overview = useResource<Overview>('/operator/overview', revision);
  const hubs = overview.data?.hubs ?? [];
  return <>
    <section className="hero-card"><div><h2>Trạng thái mạng lưới</h2><p>Theo dõi xe, chỗ đỗ, công suất sạc và tình trạng nhận tín hiệu của từng hub.</p></div><Circuit /></section>
    <ResourceStatus resources={[overview]} />
    <div className="stats">
      <Stat icon="bike" label="Xe có thể cấp phát" value={sum(hubs,'availableVehicles')} />
      <Stat icon="parking" label="Chỗ đỗ đang sử dụng" value={`${sum(hubs,'occupiedSlots')} / ${sum(hubs,'totalSlots')}`} />
      <Stat icon="alert" label="Cảnh báo đang mở" value={sum(hubs,'openAlerts')} />
    </div>
    <div className="triple">
      {hubs.map((hub) => <Card key={hub.id} title={hub.name} extra={<Badge value={hub.stale ? 'Stale' : 'Healthy'} />}>
        <dl className="details">
          <dt>Xe khả dụng</dt><dd>{hub.availableVehicles}</dd>
          <dt>Chỗ đỗ xe chung</dt><dd>{hub.availableSlots} chỗ khả dụng</dd>
          <dt>Chiếm dụng vật lý</dt><dd>{hub.occupiedSlots}/{hub.totalSlots}{hub.parkingOccupancyPct !== null && hub.parkingOccupancyPct !== undefined ? ` · ${hub.parkingOccupancyPct.toFixed(1)}%` : ''}</dd>
          <dt>Công suất</dt><dd>{hub.powerInUseKW.toFixed(1)} / {hub.powerLimitKW} kW</dd>
          <dt>Tín hiệu gần nhất</dt><dd><DateTime value={hub.lastSeenAt} /></dd>
        </dl>
        <div className="meter" role="progressbar" aria-label={`Chiếm dụng ${hub.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hub.parkingOccupancyPct ?? undefined}>
          <span style={{ width: `${Math.max(0,Math.min(100,hub.parkingOccupancyPct ?? 0))}%` }} />
        </div>
        <hr className="divider"/>
        <h3>{hub.availablePoints} cổng sạc khả dụng</h3>
        {hub.points?.map((point) => <div className="row between" key={point.id}><span className="small">{point.id} · {point.ratedKW} kW</span><Badge value={point.blocked ? 'Blocked' : point.occupancy} /></div>)}
        <details><summary>Chi tiết vị trí đỗ</summary>
          <DataTable rows={hub.slots} label={`Vị trí đỗ ${hub.name}`} empty="Hub chưa có vị trí đỗ." columns={[
            {label:'Vị trí',value:slot => slot.id},
            {label:'Xe hiện diện',value:slot => slot.vehicleId ?? '—'},
            {label:'Trạng thái vật lý',value:slot => <Badge value={slot.blocked ? 'Blocked' : slot.vehicleId ? 'Occupied' : 'Empty'} />},
          ]}/>
        </details>
      </Card>)}
    </div>
    {!hubs.length && !overview.pending && <Empty>Chưa có dữ liệu hub.</Empty>}
  </>;
}

export function OperatorAlerts({ revision, refresh }: PageProps) {
  const alerts = useResource<Alert[]>('/operator/alerts',revision);
  const hubs = useResource<HubView[]>('/hubs',revision);
  const [filter, setFilter] = useState('Open');
  const action = useAction(refresh);
  const acknowledge = (alert: Alert) => action.run(() => mutate(`/operator/alerts/${alert.id}/acknowledge`, { expectedVersion:alert.version }), 'Đã tiếp nhận cảnh báo.');
  return <>
    <ResourceStatus resources={[alerts,hubs]} />
    <Feedback feedback={action.feedback} />
    <Card title="Cảnh báo tài nguyên" extra={<Field label="Lọc trạng thái"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="Open">Đang mở</option><option value="Resolved">Đã xử lý</option><option value="">Tất cả</option></select></Field>}>
      <DataTable rows={(alerts.data ?? []).filter((item) => !filter || item.status===filter)} label="Danh sách cảnh báo" empty="Không có cảnh báo theo bộ lọc." columns={[
        { label:'Hub', value:(item) => hubName(hubs.data ?? [],item.hubId) },
        { label:'Loại', value:(item) => item.type === 'PARKING' ? 'Chiếm dụng bãi đỗ' : 'Hết cổng sạc khả dụng' },
        { label:'Mở lúc', value:(item) => <DateTime value={item.openedAt} /> },
        { label:'Trạng thái', value:(item) => <><Badge value={item.status} />{item.acknowledgedAt && <><div className="small muted">Tiếp nhận</div><DateTime value={item.acknowledgedAt} /></>}</> },
        { label:'Thao tác', value:(item) => item.status==='Open' && !item.acknowledgedAt ? <Button compact disabled={action.busy} onClick={() => { void acknowledge(item); }}>Tiếp nhận</Button> : '—' },
      ]} />
    </Card>
  </>;
}

type DemoSummary = {
  commands: Command[]; hubs: HubView[]; points: Point[]; vehicles: VehicleView[]; slots?: Slot[];
  autoAck: boolean; pausedHubs: string[];
};

function IncidentCard({ incident, refresh }: { incident: Incident; refresh: () => void }) {
  const [resolution, setResolution] = useState('');
  const action = useAction(refresh);
  const restore = () => action.run(() => mutate(`/operator/incidents/${incident.id}/restore`, { expectedVersion:incident.version,resolution }), 'Đã ghi nhận kết quả phục hồi.');
  const isolate = () => action.run(() => mutate(`/operator/incidents/${incident.id}/isolate`, { expectedVersion:incident.version }), 'Đã cô lập và ghi các giao dịch bị ảnh hưởng.');
  return <Card title={incident.resourceId} subtitle={incident.description} extra={<Badge value={incident.status} />}>
    <div className="small muted">Phiếu xử lý {incident.ticketId ?? 'chưa tạo'}</div>
    {!!incident.impacts?.length && <ul>{incident.impacts.map((impact,index) => <li key={index}>{impact}</li>)}</ul>}
    <Feedback feedback={action.feedback} />
    {incident.status === 'Reported' && <div><Button tone="primary" disabled={action.busy} onClick={() => { void isolate(); }}>Cô lập tài nguyên</Button></div>}
    {incident.status === 'Isolated' && <form className="stack" onSubmit={(event) => submit(event, () => { void restore(); })}>
      <Field label="Kết quả sửa chữa"><input required maxLength={500} value={resolution} onChange={(event) => setResolution(event.target.value)} /></Field>
      <div><Button tone="primary" type="submit" disabled={action.busy || !resolution.trim()}>Xác nhận phục hồi</Button></div>
    </form>}
  </Card>;
}

export function OperatorIncidents({ revision, refresh }: PageProps) {
  const incidents = useResource<Incident[]>('/operator/incidents',revision);
  const demo = useResource<DemoSummary>('/operator/demo/events',revision);
  const [resourceType,setResourceType] = useState<'vehicle'|'point'|'slot'>('vehicle');
  const [resourceId,setResourceId] = useState('');
  const [description,setDescription] = useState('');
  const action = useAction(refresh);
  const resources = resourceType === 'vehicle' ? demo.data?.vehicles : resourceType === 'point' ? demo.data?.points : demo.data?.slots;
  async function report() {
    const result = await action.run(() => mutate('/incidents', {resourceType,resourceId,description}), 'Đã ghi nhận sự cố.');
    if (result) setDescription('');
  }
  return <>
    <ResourceStatus resources={[incidents,demo]} />
    <Feedback feedback={action.feedback} />
    <Card title="Ghi nhận sự cố">
      <form className="stack" onSubmit={(event) => submit(event, () => { void report(); })}>
        <div className="row">
          <Field label="Loại tài nguyên"><select value={resourceType} onChange={(event) => { setResourceType(event.target.value as typeof resourceType); setResourceId(''); }}><option value="vehicle">Xe dùng chung</option><option value="point">Cổng sạc</option><option value="slot">Chỗ đỗ</option></select></Field>
          <Field label="Mã tài nguyên">{resources?.length ? <select required value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">Chọn tài nguyên</option>{resources.map((item) => <option value={item.id} key={item.id}>{item.id}</option>)}</select>
            : <input required value={resourceId} onChange={(event) => setResourceId(event.target.value)} />}</Field>
        </div>
        <Field label="Mô tả sự cố"><textarea required maxLength={800} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <div><Button type="submit" tone="primary" disabled={action.busy || !description.trim() || !resourceId}>Tạo báo cáo</Button></div>
      </form>
    </Card>
    {incidents.data?.length ? <div className="triple">{[...incidents.data].reverse().map((item) => <IncidentCard key={item.id} incident={item} refresh={refresh} />)}</div> : <Empty>Chưa có báo cáo sự cố.</Empty>}
  </>;
}

function OrderCard({ order, hubs, refresh }: { order: Order; hubs: HubView[]; refresh: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const action = useAction(refresh);
  const root = `/operator/redistributions/${order.id}`;
  const request = (operation: string, text: string, input: Record<string,unknown> = {}) => action.run(() => mutate(`${root}/${operation}`, { expectedVersion:order.version,...input }), text);
  const allocated = order.items.filter((item) => item.status==='Allocated');
  const selectedAllocated = selected.filter((id) => allocated.some((item) => item.id===id));
  const canCancel = ['Proposed','Confirmed'].includes(order.status) && !order.items.some((item) => item.departedAt !== null);
  const canComplete = order.items.some((item) => item.status==='Arrived') && order.items.every((item) => ['Arrived','Completed','Dropped','Cancelled'].includes(item.status));
  return <Card title={`${hubName(hubs,order.sourceHubId)} → ${hubName(hubs,order.destinationHubId)}`} subtitle={`${order.quantity} xe · ${order.id}`} extra={<Badge value={order.status}/>}>
    <Feedback feedback={action.feedback} />
    {order.items.length > 0 && <DataTable rows={order.items} label="Phương tiện trong lệnh điều phối" empty="Chưa cấp xe." columns={[
      { label:'Xuất phát', value:(item) => item.status === 'Allocated' ? <input aria-label={`Chọn ${item.vehicleId} để xuất phát`} type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((values) => event.target.checked ? [...values,item.id] : values.filter((id) => id!==item.id))} /> : <DateTime value={item.departedAt}/> },
      { label:'Xe', value:(item) => item.vehicleId },
      { label:'Trạng thái', value:(item) => <Badge value={item.status} /> },
      { label:'Thao tác', value:(item) => item.status === 'InTransit' ? <Button compact disabled={action.busy} onClick={() => { void request('arrivals', 'Đã ghi nhận xe đến hub đích.', { itemId:item.id, hubId:order.destinationHubId }); }}>Ghi nhận đến</Button>
        : item.status === 'NeedsOperatorAction' ? <div className="actions"><Button compact disabled={action.busy} onClick={() => { void request('resolve-item','Đã gửi yêu cầu tiếp tục.',{ itemId:item.id, action:'resume' }); }}>Tiếp tục</Button>
          {item.departedAt === null && <Button compact disabled={action.busy} onClick={() => { void request('resolve-item','Đã bỏ xe khỏi lệnh.',{ itemId:item.id, action:'drop' }); }}>Bỏ xe</Button>}</div> : '—' },
    ]} />}
    <div className="actions">
      {order.status==='Proposed' && <Button tone="primary" disabled={action.busy} onClick={() => { void request('confirm','Đã xác nhận lệnh và giữ chỗ đích.'); }}>Xác nhận lệnh</Button>}
      {allocated.length > 0 && <Button tone="primary" disabled={action.busy} onClick={() => { void request('start','Đã ghi nhận xuất phát.',{ itemIds:selectedAllocated.length ? selectedAllocated : allocated.map((item) => item.id) }); }}>{selectedAllocated.length ? `Xuất phát ${selectedAllocated.length} xe đã chọn` : 'Xuất phát tất cả xe đã cấp'}</Button>}
      {canComplete && <Button tone="primary" disabled={action.busy} onClick={() => { void request('complete','Đã hoàn tất lệnh điều phối.'); }}>Hoàn tất lệnh</Button>}
      {canCancel && <Button tone="danger" disabled={action.busy} onClick={() => { void request('cancel','Đã hủy lệnh điều phối.',{reason:'Điều phối viên hủy trước xuất phát'}); }}>Hủy lệnh</Button>}
    </div>
  </Card>;
}

export function OperatorRedistribution({ revision, refresh }: PageProps) {
  const orders = useResource<Order[]>('/operator/redistributions',revision);
  const hubs = useResource<HubView[]>('/hubs',revision);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [quantity, setQuantity] = useState(1);
  const action = useAction(refresh);
  return <>
    <ResourceStatus resources={[orders,hubs]}/>
    <Feedback feedback={action.feedback}/>
    <Card title="Đề xuất lệnh điều phối" subtitle="Xe và chỗ đỗ đích sẽ được giữ khi xác nhận lệnh.">
      <form className="stack" onSubmit={(event) => submit(event, () => {
        void action.run(() => mutate('/operator/redistributions', { sourceHubId:source,destinationHubId:destination,quantity }), 'Đã tạo đề xuất điều phối.');
      })}>
        <div className="row">
          <HubField label="Hub nguồn" hubs={hubs.data ?? []} value={source} onChange={(value) => { setSource(value); if (value===destination) setDestination(''); }}/>
          <HubField label="Hub đích" hubs={hubs.data ?? []} exclude={source} value={destination} onChange={setDestination}/>
          <Field label="Số lượng xe"><input required type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)}/></Field>
        </div>
        <div><Button type="submit" tone="primary" disabled={action.busy || !source || !destination}>Tạo đề xuất</Button></div>
      </form>
    </Card>
    {orders.data?.length ? <div className="stack">{[...orders.data].reverse().map((order) => <OrderCard key={order.id} order={order} hubs={hubs.data ?? []} refresh={refresh}/>)}</div> : <Empty>Chưa có lệnh điều phối.</Empty>}
  </>;
}

export function OperatorPlans({ revision, refresh }: PageProps) {
  const hubs = useResource<HubView[]>('/hubs',revision);
  const plans = useResource<ChargingPlan[]>('/operator/charging-plans',revision);
  const [hub, setHub] = useState('');
  const [override, setOverride] = useState('');
  const action = useAction(refresh);
  const createPlan = () => action.run(() => mutate('/operator/charging-plans/preview', { hubId:hub, ...(override.trim() ? {overrides:override.split(/[\s,]+/).filter(Boolean)} : {}) }), 'Đã lập kế hoạch đề xuất.');
  const apply = (plan: ChargingPlan) => action.run(() => mutate(`/operator/charging-plans/${plan.id}/apply`, { expectedVersion:plan.version }), 'Đã áp dụng lịch sạc.');
  return <>
    <ResourceStatus resources={[hubs,plans]}/>
    <Feedback feedback={action.feedback}/>
    <Card title="Lập lịch sạc" subtitle="Tạo đề xuất, xem công suất và thứ tự ưu tiên trước khi áp dụng.">
      <form className="stack" onSubmit={(event) => submit(event, () => { void createPlan(); })}>
        <div className="row"><HubField hubs={hubs.data ?? []} value={hub} onChange={setHub}/>
          <Field label="Mã phiên cần ưu tiên, cách nhau bằng dấu phẩy (tùy chọn)"><input value={override} onChange={(event) => setOverride(event.target.value)} /></Field></div>
        <div><Button type="submit" tone="primary" disabled={action.busy || !hub}>Xem kế hoạch đề xuất</Button></div>
      </form>
    </Card>
    {plans.data?.length ? <div className="stack">{[...plans.data].reverse().map((plan) => <Card key={plan.id} title={`Kế hoạch · ${hubName(hubs.data ?? [],plan.hubId)}`} subtitle={plan.id} extra={<Badge value={plan.status} />}>
      <DataTable rows={plan.assignments.map((entry) => ({ ...entry, id:entry.sessionId }))} label="Lịch đề xuất" empty="Chưa có phiên đủ điều kiện xếp lịch." columns={[
        { label:'Phiên', value:(item) => item.sessionId },
        { label:'Cổng', value:(item) => item.pointId },
        { label:'Giờ sạc', value:(item) => <><DateTime value={item.startAt} /><div className="small muted">Đến <DateTime value={item.endAt} /></div></> },
        { label:'Công suất', value:(item) => `${item.powerKW} kW` }, { label:'Điểm ưu tiên', value:(item) => item.priority.toFixed(2) },
      ]}/>
      {!!plan.excluded.length && <details><summary>Phiên chưa thể xếp lịch ({plan.excluded.length})</summary><ul>{plan.excluded.map((item) => <li key={item.sessionId}>{item.sessionId} · {item.reason}</li>)}</ul></details>}
      {plan.status==='Proposed' && <div><Button tone="primary" disabled={action.busy || !plan.assignments.length} onClick={() => { void apply(plan); }}>Áp dụng lịch</Button></div>}
    </Card>)}</div> : <Empty>Chưa có kế hoạch sạc.</Empty>}
  </>;
}
