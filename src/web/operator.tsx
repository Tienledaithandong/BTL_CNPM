import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Alert, ChargingPlan, Command, Incident, Order, Point, Slot } from '../api/types';
import type { HubView, VehicleView } from './client';
import { mutate, useAction, useResource } from './client';
import { Badge, Card, DateTime, Empty, Field, Stat } from './ui';
import { Button, DataTable, Feedback, HubField, ResourceStatus, hubName } from './components';
import { CapacityMeter, HubStatus, NetworkMap } from './hubs';

export type OperatorPage = 'overview' | 'alerts' | 'incidents' | 'redistribution' | 'plans' | 'scenarios' | 'demo';
type PageProps = { revision: number; refresh: () => void };
const submit = (event: FormEvent<HTMLFormElement>, action: () => void) => { event.preventDefault(); action(); };

type HubOverview = Omit<HubView, 'points'> & {
  occupiedSlots: number; totalSlots: number; parkingOccupancyPct: number | null; powerInUseKW: number; stale: boolean;
  openAlerts: number; slots: Slot[]; points: Array<Point & { occupancy: string; activeSessionId: string | null }>;
};
type Overview = { hubs: HubOverview[] };
const sum = (hubs: HubView[], key: 'availableVehicles' | 'openAlerts' | 'occupiedSlots' | 'totalSlots' | 'powerInUseKW') => hubs.reduce((total, hub) => total + hub[key], 0);
const alertLabel = (item: Alert) => item.type === 'PARKING' ? 'Chiếm dụng bãi đỗ' : 'Hết cổng sạc khả dụng';

export function OperatorOverview({ revision, alerts, selectedHub, onSelectHub, onAlerts }: Pick<PageProps, 'revision'> & {
  alerts: Alert[]; selectedHub: string; onSelectHub: (id: string) => void; onAlerts: () => void;
}) {
  const overview = useResource<Overview>('/operator/overview', revision);
  const hubs = overview.data?.hubs ?? [];
  const current = hubs.find(hub => hub.id === selectedHub) ?? hubs[0];
  const online = hubs.filter(hub => !hub.stale);
  const totalSlots = sum(online, 'totalSlots');
  const open = alerts.filter(alert => alert.status === 'Open');
  return <>
    <ResourceStatus resources={[overview]} />
    <div className="stats dashboard-stats">
      <Stat label="Xe khả dụng" value={overview.data ? sum(hubs,'availableVehicles') : '—'} />
      <Stat label="Chiếm dụng bãi đỗ" value={totalSlots ? `${Math.round(sum(online,'occupiedSlots') / totalSlots * 100)}%` : '—'}
        hint={totalSlots ? `${sum(online,'occupiedSlots')}/${totalSlots} chỗ đang dùng` : undefined} />
      <Stat label="Công suất sạc đang dùng" value={overview.data ? `${sum(hubs,'powerInUseKW').toLocaleString('vi-VN')} kW` : '—'} />
      <Stat label="Cảnh báo đang mở" value={overview.data ? sum(hubs,'openAlerts') : '—'} tone={open.length ? 'error' : undefined} />
    </div>
    <div className="dashboard-grid">
      <NetworkMap hubs={hubs} selected={selectedHub} onSelect={onSelectHub} />
      <div className="stack dashboard-aside">
        <Card title="Cảnh báo đang mở" extra={<span className="count-chip">{open.length}</span>}>
          {open.length ? open.map(alert => <button className="dashboard-alert" type="button" key={alert.id} onClick={onAlerts}>
            <strong>{hubName(hubs,alert.hubId)}</strong><span>{alertLabel(alert)} · <DateTime value={alert.openedAt} /></span>
          </button>) : <p className="muted small">Không có cảnh báo đang mở.</p>}
        </Card>
        {current && <Card key={current.id} title={current.name} extra={<HubStatus hub={current} />}>
          <CapacityMeter label="Chỗ đỗ" used={current.stale ? null : current.occupiedSlots} capacity={current.totalSlots} />
          <CapacityMeter label="Công suất sạc đang dùng (kW)" used={current.stale ? null : current.powerInUseKW} capacity={current.powerLimitKW} />
          <p className="small muted">{current.availableVehicles} xe · {current.availableSlots} chỗ đỗ xe chung · {current.availablePoints} cổng sạc khả dụng</p>
          <p className="small muted">Tín hiệu gần nhất <DateTime value={current.lastSeenAt} /></p>
          <details><summary>Chi tiết cổng sạc</summary>{current.points.map(point => <div className="row between" key={point.id}><span className="small">{point.id} · {point.ratedKW} kW</span><Badge value={point.blocked ? 'Blocked' : point.occupancy} /></div>)}</details>
          <details><summary>Chi tiết vị trí đỗ</summary>
            <DataTable rows={current.slots} label={`Vị trí đỗ ${current.name}`} empty="Hub chưa có vị trí đỗ." columns={[
              {label:'Vị trí',value:slot => slot.id},
              {label:'Xe hiện diện',value:slot => slot.vehicleId ?? '—'},
              {label:'Trạng thái vật lý',value:slot => <Badge value={slot.blocked ? 'Blocked' : slot.vehicleId ? 'Occupied' : 'Empty'} />},
            ]}/>
          </details>
        </Card>}
      </div>
    </div>
    {!!hubs.length && <Card title="Tỷ lệ chiếm dụng bãi đỗ theo Hub" extra={<span className="small muted">70% gần đầy · 90% quá tải</span>}>
      <div className="triple">{hubs.map(hub => <CapacityMeter key={hub.id} label={hub.name} used={hub.stale ? null : hub.occupiedSlots} capacity={hub.totalSlots} />)}</div>
    </Card>}
    {!hubs.length && !overview.pending && <Empty>Chưa có dữ liệu hub.</Empty>}
  </>;
}

export function OperatorAlerts({ revision, refresh }: PageProps) {
  const alerts = useResource<Alert[]>('/operator/alerts',revision);
  const hubs = useResource<HubView[]>('/hubs',revision);
  const [filter, setFilter] = useState('Open');
  const [selected, setSelected] = useState('');
  const action = useAction(refresh);
  const acknowledge = (alert: Alert) => action.run(() => mutate(`/operator/alerts/${alert.id}/acknowledge`, { expectedVersion:alert.version }), 'Đã tiếp nhận cảnh báo.');
  const visible = (alerts.data ?? []).filter(item => !filter || item.status === filter);
  const latest = (alerts.data ?? []).find(item => item.status === 'Open' && !item.acknowledgedAt);
  const current = visible.find(item => item.id === selected);
  const hub = hubs.data?.find(item => item.id === current?.hubId);
  return <>
    <ResourceStatus resources={[alerts,hubs]} />
    <Feedback feedback={action.feedback} />
    {latest && <div className="alert-banner"><div><strong>{alertLabel(latest)} · {hubName(hubs.data ?? [],latest.hubId)}</strong>
      <p className="small">Phát hiện <DateTime value={latest.openedAt} /></p></div>
      <Button tone="primary" disabled={action.busy} onClick={() => { void acknowledge(latest); }}>Xác nhận đã nhận thông tin</Button>
    </div>}
    <div className="split-workspace alerts-layout">
    <Card title="Cảnh báo tài nguyên">
      <Field label="Lọc trạng thái"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="Open">Đang mở</option><option value="Resolved">Đã xử lý</option><option value="">Tất cả</option></select></Field>
      <DataTable rows={visible} label="Danh sách cảnh báo" empty="Không có cảnh báo theo bộ lọc." columns={[
        { label:'Hub', value:(item) => <button className="text-button" type="button" onClick={() => setSelected(item.id)}>{hubName(hubs.data ?? [],item.hubId)}</button> },
        { label:'Loại', value:alertLabel },
        { label:'Mở lúc', value:(item) => <DateTime value={item.openedAt} /> },
        { label:'Trạng thái', value:(item) => <><Badge value={item.status} />{item.acknowledgedAt && <><div className="small muted">Tiếp nhận</div><DateTime value={item.acknowledgedAt} /></>}</> },
        { label:'Thao tác', value:(item) => item.status==='Open' && !item.acknowledgedAt ? <Button compact disabled={action.busy} onClick={() => { void acknowledge(item); }}>Tiếp nhận</Button> : '—' },
      ]} />
    </Card>
    {current ? <Card title={hubName(hubs.data ?? [],current.hubId)} subtitle={alertLabel(current)} extra={<Badge value={current.status} />}>
      <dl className="details"><dt>Phát hiện</dt><dd><DateTime value={current.openedAt} /></dd>
        <dt>Tiếp nhận</dt><dd><DateTime value={current.acknowledgedAt} /></dd><dt>Xử lý</dt><dd><DateTime value={current.resolvedAt} /></dd></dl>
      {hub && <CapacityMeter label="Chỗ đỗ hiện tại" used={hub.stale ? null : hub.occupiedSlots} capacity={hub.totalSlots} />}
    </Card> : <Card className="empty-panel"><p>Chọn một cảnh báo để xem chi tiết</p></Card>}
    </div>
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
    <div className="split-workspace incident-layout">
    <Card title="Ghi nhận sự cố">
      <form className="stack" onSubmit={(event) => submit(event, () => { void report(); })}>
        <div className="stack">
          <Field label="Loại tài nguyên"><select value={resourceType} onChange={(event) => { setResourceType(event.target.value as typeof resourceType); setResourceId(''); }}><option value="vehicle">Xe dùng chung</option><option value="point">Cổng sạc</option><option value="slot">Chỗ đỗ</option></select></Field>
          <Field label="Mã tài nguyên">{resources?.length ? <select required value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">Chọn tài nguyên</option>{resources.map((item) => <option value={item.id} key={item.id}>{item.id}</option>)}</select>
            : <input required value={resourceId} onChange={(event) => setResourceId(event.target.value)} />}</Field>
        </div>
        <Field label="Mô tả sự cố"><textarea required maxLength={800} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <div><Button type="submit" tone="primary" disabled={action.busy || !description.trim() || !resourceId}>Tạo báo cáo</Button></div>
      </form>
    </Card>
    {incidents.data?.length ? <div className="stack">{[...incidents.data].reverse().map((item) => <IncidentCard key={item.id} incident={item} refresh={refresh} />)}</div> : <Card className="empty-panel"><p>Kết quả cô lập sẽ hiển thị ở đây</p></Card>}
    </div>
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
  const latest = orders.data?.at(-1);
  const orderStep = !latest || ['Cancelled','Failed'].includes(latest.status) ? 0
    : ['Completed','PartiallyCompleted'].includes(latest.status) ? 3 : ['InTransit','Arrived'].includes(latest.status) ? 2 : 1;
  return <>
    <ResourceStatus resources={[orders,hubs]}/>
    <Feedback feedback={action.feedback}/>
    <p className="muted">Tạo và thực hiện lệnh điều chuyển phương tiện giữa các Hub.</p>
    <ol className="stage-list" aria-label="Tiến độ điều phối">{['Chọn Hub và số xe','Xem phương án','Vận chuyển','Hoàn tất'].map((step,index) =>
      <li key={step} aria-current={index === orderStep ? 'step' : undefined}>{index + 1}. {step}</li>)}</ol>
    <Card title="Trạng thái các Hub">
      <DataTable rows={hubs.data ?? []} label="Trạng thái các Hub" empty="Chưa có dữ liệu Hub." columns={[
        {label:'Hub',value:hub => <strong>{hub.name}{source === hub.id && <span className="route-tag">Nguồn</span>}{destination === hub.id && <span className="route-tag">Đích</span>}</strong>},
        {label:'Xe khả dụng',value:hub => hub.stale ? '—' : hub.availableVehicles},
        {label:'Chỗ đỗ đang dùng',value:hub => hub.stale ? '—' : `${hub.occupiedSlots}/${hub.totalSlots}`},
        {label:'Cổng sạc khả dụng',value:hub => hub.stale ? '—' : hub.availablePoints},
        {label:'Trạng thái',value:hub => <HubStatus hub={hub} />},
      ]} />
    </Card>
    <Card title="Đề xuất lệnh điều phối" subtitle="Xe và chỗ đỗ đích sẽ được giữ khi xác nhận lệnh.">
      <form className="stack" onSubmit={(event) => submit(event, () => {
        void action.run(() => mutate('/operator/redistributions', { sourceHubId:source,destinationHubId:destination,quantity }), 'Đã tạo đề xuất điều phối.');
      })}>
        <div className="redistribution-fields">
          <HubField label="Hub nguồn" hubs={hubs.data ?? []} value={source} onChange={(value) => { setSource(value); if (value===destination) setDestination(''); }}/>
          <HubField label="Hub đích" hubs={hubs.data ?? []} exclude={source} value={destination} onChange={setDestination}/>
          <Field label="Số lượng xe"><input required type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)}/></Field>
        </div>
        <div className="actions form-footer"><Button type="submit" tone="primary" disabled={action.busy || !source || !destination}>Tạo đề xuất</Button></div>
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
    <p className="muted">Lập lịch cho các phiên sạc đang chờ tại một Hub.</p>
    <Card title="Chọn Hub để lập lịch">
      <form className="stack" onSubmit={(event) => submit(event, () => { void createPlan(); })}>
        <div className="row"><HubField hubs={hubs.data ?? []} value={hub} onChange={setHub}/>
          <Field label="Mã phiên cần ưu tiên, cách nhau bằng dấu phẩy (tùy chọn)"><input value={override} onChange={(event) => setOverride(event.target.value)} /></Field></div>
        <div className="actions form-footer"><Button type="submit" tone="primary" disabled={action.busy || !hub}>Xem kế hoạch đề xuất</Button></div>
      </form>
    </Card>
    {plans.data?.length ? <div className="stack">{[...plans.data].reverse().map((plan) => {
      const status = hubs.data?.find(item => item.id === plan.hubId);
      return <Card key={plan.id} title={`Lịch sạc đề xuất · ${hubName(hubs.data ?? [],plan.hubId)}`} subtitle={plan.id} extra={<Badge value={plan.status} />}>
      <div className="plan-formula"><strong>Điểm ưu tiên = (100 − mức pin) + 10 / số giờ còn lại</strong>
        <p className="small muted">Phiên không có thời hạn được tính điểm theo mức pin.</p></div>
      {status && <div className="grid-2">
        <CapacityMeter label="Cổng sạc không khả dụng" used={status.stale ? null : (status.points?.length ?? 0) - status.availablePoints} capacity={status.points?.length ?? 0} />
        <CapacityMeter label="Công suất đang dùng (kW)" used={status.stale ? null : status.powerInUseKW} capacity={status.powerLimitKW} />
      </div>}
      <DataTable rows={plan.assignments.map((entry) => ({ ...entry, id:entry.sessionId }))} label="Lịch đề xuất" empty="Chưa có phiên đủ điều kiện xếp lịch." columns={[
        { label:'Phiên', value:(item) => item.sessionId },
        { label:'Cổng', value:(item) => item.pointId },
        { label:'Giờ sạc', value:(item) => <><DateTime value={item.startAt} /><div className="small muted">Đến <DateTime value={item.endAt} /></div></> },
        { label:'Công suất', value:(item) => `${item.powerKW} kW` }, { label:'Điểm ưu tiên', value:(item) => item.priority.toFixed(2) },
      ]}/>
      {!!plan.excluded.length && <details><summary>Phiên chưa thể xếp lịch ({plan.excluded.length})</summary><ul>{plan.excluded.map((item) => <li key={item.sessionId}>{item.sessionId} · {item.reason}</li>)}</ul></details>}
      {plan.status==='Proposed' && <div className="actions form-footer"><Button tone="primary" disabled={action.busy || !plan.assignments.length} onClick={() => { void apply(plan); }}>Áp dụng lịch</Button></div>}
    </Card>})}</div> : <Empty>Chưa có kế hoạch sạc.</Empty>}
  </>;
}
