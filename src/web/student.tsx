import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Invoice, ParkingBooking, PrivateVehicle, Session, Notification } from '../api/types';
import type { HubView, ReservationView, TripView, VehicleView } from './client';
import { mutate, useAction, useResource } from './client';
import { Badge, Card, Circuit, DateTime, Empty, Field, Icon, Stat, money } from './ui';
import { Button, DataTable, Feedback, HubField, ResourceStatus, hubName, isoInput, localInput } from './components';

export type StudentPage = 'map' | 'rides' | 'parking' | 'charging' | 'history';
type PageProps = { revision: number; refresh: () => void };
const submit = (event: FormEvent<HTMLFormElement>, action: () => void) => { event.preventDefault(); action(); };

export function StudentMap({ revision, refresh, onBooked }: PageProps & { onBooked: () => void }) {
  const hubs = useResource<HubView[]>('/hubs', revision);
  const vehicles = useResource<VehicleView[]>('/vehicles', revision);
  const [selectedHub, setSelectedHub] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [filter, setFilter] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [destination, setDestination] = useState('');
  const action = useAction(refresh);
  const rows = hubs.data ?? [];
  const currentHub = rows.find((hub) => hub.id === selectedHub);
  const types = [...new Set((vehicles.data ?? []).map((vehicle) => vehicle.type))];
  const query = filter.trim().toLocaleLowerCase('vi');
  const filteredHubs = rows.filter((hub) => !query || [hub.id, hub.name].some((value) => value.toLocaleLowerCase('vi').includes(query)));
  const filteredVehicles = (vehicles.data ?? []).filter((vehicle) =>
    (!selectedHub || vehicle.hubId === selectedHub) && (!vehicleType || vehicle.type === vehicleType)
      && (!query || filteredHubs.some((hub) => hub.id === vehicle.hubId) || vehicle.id.toLocaleLowerCase('vi').includes(query))
  );
  const currentVehicle = (vehicles.data ?? []).find((vehicle) => vehicle.id === selectedVehicle);
  return <>
    <section className="hero-card"><div><h2>Di chuyển trong khu đô thị ĐHQG-HCM</h2><p>Chọn hub để xem xe, chỗ đỗ và cổng sạc đang khả dụng.</p></div><Circuit /></section>
    <ResourceStatus resources={[hubs, vehicles]} />
    <Feedback feedback={action.feedback} />
    <div className="stats">
      <Stat label="Hub trong mạng lưới" icon="map" value={rows.length} />
      <Stat label="Xe có thể đặt" icon="bike" value={rows.reduce((sum, hub) => sum + hub.availableVehicles, 0)} />
      <Stat label="Chỗ đỗ khả dụng" icon="parking" value={rows.reduce((sum, hub) => sum + hub.availableSlots, 0)} />
    </div>
    <Card title="Tìm hub và xe">
      <div className="row">
        <Field label="Tên hub hoặc mã xe"><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} /></Field>
        <Field label="Loại xe"><select value={vehicleType} onChange={(event) => setVehicleType(event.target.value)}><option value="">Tất cả loại xe</option>{types.map((type) => <option value={type} key={type}>{type}</option>)}</select></Field>
      </div>
      <div className="switcher" aria-label="Lọc xe theo hub">
        <button type="button" className={`button compact ${selectedHub ? '' : 'primary'}`} aria-pressed={!selectedHub} onClick={() => setSelectedHub('')}>Tất cả hub</button>
        {filteredHubs.map((hub) => <button type="button" className={`button compact ${selectedHub === hub.id ? 'primary' : ''}`} key={hub.id} aria-pressed={selectedHub === hub.id} onClick={() => setSelectedHub(hub.id)}>{hub.name} · {hub.availableVehicles} xe</button>)}
      </div>
      {currentHub && <p className="card-sub">{currentHub.availableSlots} chỗ đỗ · {currentHub.availablePoints} cổng sạc khả dụng · Cập nhật <DateTime value={currentHub.lastSeenAt} /></p>}
    </Card>
    {currentVehicle && <Card title={`Đặt xe ${currentVehicle.id}`} subtitle={`Nhận tại ${hubName(rows, currentVehicle.hubId)}. Giữ xe và chỗ đỗ đích trong cùng một lượt đặt.`} extra={<Button onClick={() => setSelectedVehicle('')}>Đóng</Button>}>
      <form className="stack" onSubmit={(event) => submit(event, () => {
        void action.run(() => mutate<ReservationView>('/reservations', { vehicleId: currentVehicle.id, destinationHubId: destination }), 'Đặt xe và giữ chỗ đích thành công.').then((reservation) => { if (reservation) onBooked(); });
      })}>
        <HubField hubs={rows} label="Hub trả xe" value={destination} onChange={setDestination} />
        <div className="actions"><Button type="submit" tone="primary" disabled={action.busy || !currentVehicle.eligible || !destination}>Xác nhận đặt và giữ chỗ</Button></div>
      </form>
    </Card>}
    <Card title={currentHub ? `Xe tại ${currentHub.name}` : 'Xe trong mạng lưới'} extra={<span className="small muted">{filteredVehicles.length} kết quả</span>}>
      <DataTable rows={filteredVehicles} label="Các xe ở hub" empty="Không có xe khớp điều kiện tìm kiếm." columns={[
        { label:'Xe', value:(vehicle) => <><strong>{vehicle.id}</strong><div className="small muted">{vehicle.type}</div></> },
        { label:'Vị trí', value:(vehicle) => hubName(rows, vehicle.hubId) },
        { label:'Pin', value:(vehicle) => vehicle.batteryPercent === null ? 'Chưa xác định' : <div className="stack"><strong className="tabular">{vehicle.batteryPercent}%</strong><div className="meter" aria-hidden="true"><span style={{ width: `${vehicle.batteryPercent}%` }} /></div></div> },
        { label:'Cập nhật', value:(vehicle) => <DateTime value={vehicle.observedAt} /> },
        { label:'Trạng thái', value:(vehicle) => <><Badge value={vehicle.mobilityStatus} />{!vehicle.eligible && vehicle.reason && <div className="small muted">{vehicle.reason}</div>}</> },
        { label:'Thao tác', value:(vehicle) => <Button compact disabled={!vehicle.eligible} onClick={() => { setSelectedVehicle(vehicle.id); setDestination(''); document.getElementById('workspace')?.scrollIntoView({ block:'start' }); }}>Đặt xe</Button> },
      ]} />
    </Card>
  </>;
}

function Expiry({ expiresAt, pending }: { expiresAt: number; pending: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []);
  if (pending) return <>Đang chờ xác nhận từ thiết bị</>;
  const seconds = Math.max(0, Math.ceil((expiresAt - now)/1000));
  const display = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  return <span className="tabular">{seconds ? `Còn ${display}` : 'Đã đến hạn giữ xe'}</span>;
}

function ReservationCard({ reservation, hubs, refresh }: { reservation: ReservationView; hubs: HubView[]; refresh: () => void }) {
  const [token, setToken] = useState('');
  const [destination, setDestination] = useState('');
  const action = useAction(refresh);
  const { id, version, vehicleId, hold } = reservation;
  const pending = reservation.status === 'UnlockPending';
  const change = () => action.run(() => mutate(`/reservations/${id}/change-destination`, { newHubId: destination, expectedVersion: version }), 'Đã đổi hub trả xe.');
  const pickup = () => action.run(() => mutate(`/reservations/${id}/pickup`, { token, expectedVersion:version }), 'Đã gửi yêu cầu mở khóa.');
  const cancel = () => action.run(() => mutate(`/reservations/${id}/cancel`, { reason:'Sinh viên hủy lượt đặt', expectedVersion:version }), 'Đã hủy lượt đặt.');
  return <Card title={`Lượt đặt · ${vehicleId}`} extra={<Badge value={reservation.status} />}>
    <dl className="details"><dt>Điểm trả</dt><dd>{hubName(hubs,hold?.hubId)} · {hold?.slotId ?? '—'}</dd><dt>Thời hạn</dt><dd><Expiry expiresAt={reservation.expiresAt} pending={pending} /></dd><dt>Mã nhận xe</dt><dd className="code-token">{reservation.token}</dd></dl>
    <Feedback feedback={action.feedback} />
    {pending ? <p role="status" className="notice">{reservation.needsReconciliation
      ? 'Chưa xác định kết quả mở khóa. Vui lòng liên hệ điều phối viên để đối soát. Xe và chỗ đỗ đích vẫn được giữ.'
      : 'Yêu cầu mở khóa đang được xác nhận. Lượt đặt và chỗ đỗ đích vẫn được giữ trong lúc đợi thiết bị.'}</p> :
      <>
        {reservation.pickupReason && <p role="status" className="notice">{reservation.pickupReason}</p>}
        <form className="stack" onSubmit={(event) => submit(event, () => { void pickup(); })}>
          <Field label="Nhập mã nhận xe"><input required value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></Field>
          <div className="actions"><Button type="submit" tone="primary" disabled={action.busy || !token.trim() || !reservation.canPickup}>Nhận xe</Button><Button onClick={() => setToken(reservation.token)}>Điền mã nhận xe</Button></div>
        </form>
        <form className="stack" onSubmit={(event) => submit(event, () => { void change(); })}>
          <HubField hubs={hubs} label="Đổi hub trả xe" exclude={hold?.hubId} value={destination} onChange={setDestination} />
          <div className="actions"><Button type="submit" disabled={action.busy || !destination}>Đổi điểm trả</Button><Button tone="danger" disabled={action.busy} onClick={() => { void cancel(); }}>Hủy lượt đặt</Button></div>
        </form>
      </>}
  </Card>;
}

function TripCard({ trip, hubs, refresh }: { trip: TripView; hubs: HubView[]; refresh: () => void }) {
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [report, setReport] = useState(false);
  const action = useAction(refresh);
  const { id, version, vehicleId, hold } = trip;
  const change = () => action.run(() => mutate(`/trips/${id}/change-destination`, { newHubId:destination, expectedVersion:version }), 'Đã đổi hub trả xe.');
  async function returnRide() {
    const result = await action.run(() => mutate<TripView & { returnPending?: boolean; reason?: string }>(
      '/trips/'+id+'/return', { hubId:hold?.hubId, slotId:hold?.slotId, expectedVersion:version },
    ));
    if (result) {
      action.setFeedback(result.returnPending
        ? { kind:'info', text:result.reason ?? 'Điều phối viên đang xử lý chỗ trả xe. Chuyến đi vẫn còn mở.' }
        : { kind:'ok', text:'Đã hoàn tất trả xe.' });
      refresh();
    }
  }
  async function reportIncident() {
    const result = await action.run(() => mutate('/incidents', { resourceType:'vehicle', resourceId:vehicleId, description, tripId:id }), 'Đã gửi báo cáo sự cố.');
    if (result) { setDescription(''); setReport(false); }
  }
  return <Card title={`Chuyến đi · ${vehicleId}`} extra={<Badge value="InUse" />}>
    <dl className="details"><dt>Bắt đầu</dt><dd><DateTime value={trip.startedAt} /></dd><dt>Điểm trả</dt><dd>{hubName(hubs, hold?.hubId)} · {hold?.slotId ?? '—'}</dd></dl>
    <Feedback feedback={action.feedback} />
    <form className="stack" onSubmit={(event) => submit(event, () => { void change(); })}>
      <HubField hubs={hubs} label="Đổi hub trả xe" exclude={hold?.hubId} value={destination} onChange={setDestination} />
      <div className="actions"><Button type="submit" disabled={action.busy || !destination}>Đổi điểm trả</Button></div>
    </form>
    <hr className="divider" />
    <div className="actions"><Button disabled={action.busy || !hold} tone="primary" onClick={() => { void returnRide(); }}>Xác nhận trả xe</Button>
      <Button onClick={() => setReport((value) => !value)}>{report ? 'Đóng báo cáo' : 'Báo sự cố'}</Button></div>
    {report && <form className="stack" onSubmit={(event) => submit(event, () => { void reportIncident(); })}>
      <Field label="Mô tả sự cố của chuyến đi"><textarea required maxLength={800} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
      <div className="actions"><Button type="submit" disabled={action.busy || !description.trim()}>Gửi báo cáo</Button></div>
    </form>}
  </Card>;
}

export function StudentRides({ revision, refresh, onMap }: PageProps & { onMap: () => void }) {
  const hubs = useResource<HubView[]>('/hubs', revision);
  const reservations = useResource<ReservationView[]>('/me/reservations', revision);
  const trips = useResource<TripView[]>('/me/trips', revision);
  const invoices = useResource<Invoice[]>('/me/invoices', revision);
  const activeReservations = (reservations.data ?? []).filter((item) => item.status === 'Reserved' || item.status === 'UnlockPending');
  const activeTrips = (trips.data ?? []).filter((item) => item.endedAt === null);
  const lastInvoice = invoices.data?.reduce<Invoice | undefined>((recent, item) => !recent || item.createdAt > recent.createdAt ? item : recent, undefined);
  return <>
    <ResourceStatus resources={[hubs, reservations, trips, invoices]} />
    {activeReservations.length + activeTrips.length === 0 && <Card title="Không có chuyến đi đang mở"><p className="muted">Bạn có thể tìm xe khả dụng và chọn chỗ trả trước khi đặt.</p><div><Button tone="primary" onClick={onMap}>Tìm xe tại hub</Button></div></Card>}
    {activeReservations.length + activeTrips.length > 0 && <div className="triple">
      {activeReservations.map((item) => <ReservationCard key={item.id} reservation={item} hubs={hubs.data ?? []} refresh={refresh} />)}
      {activeTrips.map((item) => <TripCard key={item.id} trip={item} hubs={hubs.data ?? []} refresh={refresh} />)}
    </div>}
    {lastInvoice && <Card title="Hóa đơn gần nhất" extra={<Badge value="Completed" />}><dl className="details">
      <dt>Chuyến đi</dt><dd>{lastInvoice.tripId}</dd><dt>Số tiền</dt><dd>{money(lastInvoice.amountVnd)}</dd><dt>Thời điểm</dt><dd><DateTime value={lastInvoice.createdAt} /></dd>
    </dl></Card>}
  </>;
}

type ParkingPreview = { entries: Array<{ startAt: number; endAt: number; slotId?: string | null; costVnd?: number; available: boolean }>; costVnd?: number };
type ParkingResult = { bookings: ParkingBooking[]; skipped: Array<unknown> };
const weekdayLabels = ['CN','T2','T3','T4','T5','T6','T7'];

export function StudentParking({ revision, refresh }: PageProps) {
  const hubs = useResource<HubView[]>('/hubs', revision);
  const vehicles = useResource<PrivateVehicle[]>('/me/private-vehicles', revision);
  const bookings = useResource<ParkingBooking[]>('/me/parking-bookings', revision);
  const [vehicle, setVehicle] = useState('');
  const [hub, setHub] = useState('');
  const [start, setStart] = useState(() => localInput(2));
  const [end, setEnd] = useState(() => localInput(182));
  const [repeat, setRepeat] = useState(false);
  const [endDate, setEndDate] = useState(() => localInput(7 * 24 * 60).slice(0,10));
  const [weekdays, setWeekdays] = useState<number[]>([1,3,5]);
  const [skipConflicts, setSkip] = useState(false);
  const [preview, setPreview] = useState<{ key: string; data: ParkingPreview }>();
  const action = useAction(refresh);
  const fingerprint = JSON.stringify([vehicle, hub, start, end, repeat, endDate, weekdays]);
  const relevantPreview = preview?.key === fingerprint ? preview.data : undefined;
  const valid = !!(vehicle && hub && start && end && end > start && (!repeat || (endDate && weekdays.length)));
  const body = () => ({ privateVehicleId:vehicle, hubId:hub, startAt:isoInput(start), endAt:isoInput(end), ...(repeat ? { repeat:{ weekdays, endDate } } : {}) });
  async function viewPreview() {
    const value = await action.run(() => mutate<ParkingPreview>('/parking/preview', body()));
    if (value) setPreview({ key:fingerprint, data:value });
  }
  async function confirm() {
    const result = await action.run(() => mutate<ParkingResult>('/parking/bookings', { ...body(), skipConflicts }), 'Đã lưu các lượt đặt chỗ hợp lệ.');
    if (result) {
      setPreview(undefined);
      action.setFeedback({ kind:'ok', text:`Đã lưu ${result.bookings.length} lượt đặt. ${result.skipped.length} lượt được bỏ qua do xung đột.` });
    }
  }
  const bookEvent = (booking: ParkingBooking, event: 'arrive' | 'depart') => action.run(() => mutate(`/parking/bookings/${booking.id}/${event}`, { expectedVersion:booking.version }), event === 'arrive' ? 'Đã ghi nhận xe vào chỗ đỗ.' : 'Đã ghi nhận xe rời chỗ đỗ.');
  return <>
    <ResourceStatus resources={[hubs, vehicles, bookings]} />
    <Feedback feedback={action.feedback} />
    <Card title="Đặt chỗ xe cá nhân" subtitle="Giờ Việt Nam (UTC+7). Xem trước chỗ khả dụng và phí dự kiến rồi xác nhận.">
      <form className="stack" onSubmit={(event) => submit(event, () => { if (valid) void viewPreview(); })}>
        <div className="row"><Field label="Xe cá nhân"><select required value={vehicle} onChange={(event) => setVehicle(event.target.value)}><option value="">Chọn xe cá nhân</option>{(vehicles.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.plate} · {item.id}</option>)}</select></Field>
          <HubField hubs={hubs.data ?? []} value={hub} onChange={setHub} /></div>
        <div className="row"><Field label="Bắt đầu"><input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          <Field label="Kết thúc"><input required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></Field></div>
        <label className="checkbox"><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} /> Đặt lịch lặp theo tuần</label>
        {repeat && <><Field label="Ngày kết thúc lặp"><input required type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
          <div className="row" aria-label="Ngày trong tuần">{weekdayLabels.map((day,index) => <label className="checkbox" key={day}><input type="checkbox" checked={weekdays.includes(index)} onChange={(event) => setWeekdays((prev) => event.target.checked ? [...prev,index].sort() : prev.filter((item) => item !== index))} />{day}</label>)}</div></>}
        <div className="actions"><Button type="submit" disabled={action.busy || !valid}>Xem trước</Button></div>
      </form>
      {relevantPreview && <>
        <DataTable rows={relevantPreview.entries.map((entry,index) => ({ ...entry, id:String(index) }))} label="Lượt đỗ dự kiến" empty="Không có lượt đặt trong khoảng này." columns={[
          { label:'Bắt đầu', value:(entry) => <DateTime value={entry.startAt} /> },
          { label:'Kết thúc', value:(entry) => <DateTime value={entry.endAt} /> },
          { label:'Chỗ', value:(entry) => entry.slotId ?? '—' },
          { label:'Phí', value:(entry) => typeof entry.costVnd === 'number' ? money(entry.costVnd) : '—' },
          { label:'Kết quả', value:(entry) => <Badge value={entry.available ? 'Available' : 'Blocked'} /> },
        ]} />
        {repeat && <label className="checkbox"><input type="checkbox" checked={skipConflicts} onChange={(event) => setSkip(event.target.checked)} /> Bỏ qua các buổi xung đột</label>}
        <div><Button tone="primary" disabled={action.busy || !valid || !relevantPreview.entries.some((entry) => entry.available)} onClick={() => { void confirm(); }}>Xác nhận đặt chỗ</Button></div>
      </>}
    </Card>
    <Card title="Chỗ đỗ của tôi"><DataTable rows={bookings.data ?? []} label="Lượt đỗ của tôi" empty="Chưa có lượt đặt chỗ cá nhân." columns={[
      { label:'Vị trí', value:(booking) => <><strong>{hubName(hubs.data ?? [], booking.hubId)}</strong><div className="small muted">{booking.slotId}</div></> },
      { label:'Thời gian', value:(booking) => <><DateTime value={booking.startAt} /><div className="small muted">Đến <DateTime value={booking.endAt} /></div></> },
      { label:'Trạng thái', value:(booking) => <><Badge value={booking.status} />{booking.serviceStatus === 'Delayed' && <Badge value="Delayed" />}</> },
      { label:'Phí', value:(booking) => money(booking.costVnd) },
      { label:'Thao tác demo', value:(booking) => booking.status === 'Scheduled' ? <Button compact disabled={action.busy} onClick={() => { void bookEvent(booking,'arrive'); }}>Ghi nhận vào</Button> : booking.status === 'InUse' ? <Button compact disabled={action.busy} onClick={() => { void bookEvent(booking,'depart'); }}>Ghi nhận rời</Button> : '—' },
    ]}/></Card>
  </>;
}

type ChargingChoice = { pointId: string; startAt?: number; endAt?: number; powerKW?: number; available?: boolean };
type ChargingPreview = { energyKWh: number; durationMinutes: number; choices?: ChargingChoice[]; suggestions?: ChargingChoice[] };

export function StudentCharging({ revision, refresh }: PageProps) {
  const hubs = useResource<HubView[]>('/hubs', revision);
  const vehicles = useResource<VehicleView[]>('/vehicles', revision);
  const bookings = useResource<ParkingBooking[]>('/me/parking-bookings', revision);
  const sessions = useResource<Session[]>('/me/charging-sessions', revision);
  const trips = useResource<TripView[]>('/me/trips', revision);
  const [sharedVehicle, setSharedVehicle] = useState('');
  const [sharedTarget, setSharedTarget] = useState(80);
  const [sharedPoint, setSharedPoint] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [start, setStart] = useState(() => localInput(15));
  const [current, setCurrent] = useState(20);
  const [target, setTarget] = useState(70);
  const [power, setPower] = useState(2);
  const [preview, setPreview] = useState<{ key:string; data:ChargingPreview }>();
  const [pointId, setPointId] = useState('');
  const action = useAction(refresh);
  const activeBookings = (bookings.data ?? []).filter((booking) => ['Scheduled','InUse'].includes(booking.status));
  const booking = activeBookings.find((entry) => entry.id === bookingId);
  const fingerprint = JSON.stringify([bookingId,start,current,target,power]);
  const relevantPreview = preview?.key === fingerprint ? preview.data : undefined;
  const valid = !!(booking && start && target > current && current >= 0 && target <= 100 && power > 0);
  const body = () => ({ privateVehicleId:booking?.vehicleId, bookingId, startAt:isoInput(start), currentPercent:current, target, powerKW:power });
  async function viewPreview() {
    const result = await action.run(() => mutate<ChargingPreview>('/charging/preview', body()));
    if (result) { setPreview({ key:fingerprint, data:result }); setPointId(''); }
  }
  async function confirm() {
    const result = await action.run(() => mutate('/charging/bookings', { ...body(), ...(pointId ? { pointId } : {}) }), 'Đã đặt phiên sạc cá nhân.');
    if (result) setPreview(undefined);
  }
  const stop = (session: Session) => action.run(() => mutate(`/charging/sessions/${session.id}/stop`, { expectedVersion:session.version }), 'Đã gửi yêu cầu dừng sạc.');
  const canAskCharge = (vehicles.data ?? []).filter((vehicle) => vehicle.hubId && vehicle.healthStatus === 'OK'
    && ['Available', 'NeedsCharge'].includes(vehicle.mobilityStatus)
    && trips.data?.some((trip) => trip.vehicleId === vehicle.id && trip.endedAt !== null && Date.now() - trip.endedAt <= 30 * 60000 && trip.hold?.slotId === vehicle.slotId));
  const chargeVehicle = canAskCharge.find((vehicle) => vehicle.id === sharedVehicle);
  const sharedPoints = (hubs.data ?? []).find((hub) => hub.id === chargeVehicle?.hubId)?.points?.filter((point) => point.connectorType === chargeVehicle?.connectorType && !point.blocked) ?? [];
  return <>
    <ResourceStatus resources={[hubs, vehicles, bookings, sessions, trips]} />
    <Feedback feedback={action.feedback} />
    <div className="grid-2">
      <Card title="Yêu cầu sạc xe dùng chung" subtitle="Phiên chuyển sang đang sạc khi hệ thống nhận xác nhận cấp điện từ thiết bị.">
        <form className="stack" onSubmit={(event) => submit(event, () => { void action.run(() => mutate('/charging/requests', { vehicleId:sharedVehicle, target:sharedTarget, ...(sharedPoint ? {chargingPointId:sharedPoint} : {}) }), 'Đã gửi yêu cầu sạc xe dùng chung.'); })}>
          <Field label="Xe dùng chung đang đỗ"><select required value={sharedVehicle} onChange={(event) => { setSharedVehicle(event.target.value); setSharedPoint(''); }}><option value="">Chọn xe đang đỗ</option>{canAskCharge.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.id} · {vehicle.batteryPercent ?? '—'}% · {hubName(hubs.data ?? [],vehicle.hubId)}</option>)}</select></Field>
          {!canAskCharge.length && <p className="small muted">Bạn có thể yêu cầu sạc cho xe đã trả trong 30 phút qua.</p>}
          {!!sharedPoints.length && <Field label="Cổng sạc (tùy chọn)"><select value={sharedPoint} onChange={(event) => setSharedPoint(event.target.value)}><option value="">Chọn tự động</option>{sharedPoints.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></Field>}
          <Field label="Mức pin mục tiêu (%)"><input type="number" required min={1} max={100} value={sharedTarget} onChange={(event) => setSharedTarget(event.target.valueAsNumber)} /></Field>
          <div><Button type="submit" tone="primary" disabled={action.busy || !chargeVehicle}>Gửi yêu cầu sạc</Button></div>
        </form>
      </Card>
      <Card title="Đặt sạc xe cá nhân" subtitle="Chọn giờ Việt Nam trong khung đặt chỗ của bạn.">
        <form className="stack" onSubmit={(event) => submit(event, () => { if (valid) void viewPreview(); })}>
          <Field label="Lượt đặt chỗ"><select required value={bookingId} onChange={(event) => {
            const value = event.target.value;
            setBookingId(value);
            const selected = activeBookings.find((entry) => entry.id === value);
            if (selected) setStart(new Date(Math.ceil(Math.max(Date.now(), selected.startAt) / 60000) * 60000 + 420 * 60000).toISOString().slice(0,16));
          }}><option value="">Chọn lượt đặt chỗ</option>{activeBookings.map((entry) => <option key={entry.id} value={entry.id}>{entry.vehicleId} · {hubName(hubs.data ?? [],entry.hubId)} · {entry.slotId}</option>)}</select></Field>
          <Field label="Bắt đầu sạc"><input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          <div className="row">
            <Field label="Pin hiện tại (%)"><input type="number" min={0} max={99} required value={current} onChange={(event) => setCurrent(event.target.valueAsNumber)} /></Field>
            <Field label="Mục tiêu (%)"><input type="number" min={1} max={100} required value={target} onChange={(event) => setTarget(event.target.valueAsNumber)} /></Field>
            <Field label="Công suất (kW)"><input type="number" min={.1} step={.1} required value={power} onChange={(event) => setPower(event.target.valueAsNumber)} /></Field>
          </div>
          <div><Button type="submit" disabled={action.busy || !valid}>Kiểm tra khung sạc</Button></div>
        </form>
        {relevantPreview && <div className="stack">
          <p className="notice">Dự kiến {relevantPreview.energyKWh} kWh trong {relevantPreview.durationMinutes} phút.</p>
          {!relevantPreview.choices?.some(choice => choice.available) && <p className="notice" role="status">Khung này không có cổng và công suất phù hợp trong thời gian đỗ.</p>}
          {!!relevantPreview.choices?.length && <Field label="Cổng sạc"><select value={pointId} onChange={(event) => setPointId(event.target.value)}><option value="">Chọn tự động</option>{relevantPreview.choices.map((choice) => <option disabled={choice.available === false} value={choice.pointId} key={choice.pointId}>{choice.pointId}</option>)}</select></Field>}
          {!!relevantPreview.suggestions?.length && <div className="stack"><strong>Khung khác có thể dùng</strong>{relevantPreview.suggestions.map((choice,index) => <div className="row" key={index}><span>{choice.pointId} · <DateTime value={choice.startAt} /> · {choice.powerKW ?? '—'} kW</span>
            {choice.startAt !== undefined && choice.endAt !== undefined && choice.powerKW !== undefined && <Button compact onClick={() => {
              const {startAt, endAt, powerKW} = choice;
              if (startAt === undefined || endAt === undefined || powerKW === undefined) return;
              const localStart = new Date(startAt + 420 * 60000).toISOString().slice(0,16);
              setStart(localStart);
              setPower(powerKW);
              setPointId(choice.pointId);
              setPreview({ key:JSON.stringify([bookingId,localStart,current,target,powerKW]),
                data:{ energyKWh:relevantPreview.energyKWh, durationMinutes:(endAt-startAt)/60000, choices:[choice] } });
            }}>Dùng khung này</Button>}</div>)}</div>}
          <div><Button tone="primary" disabled={action.busy || !valid || !relevantPreview.choices?.some(choice => choice.available)} onClick={() => { void confirm(); }}>Xác nhận lịch sạc</Button></div>
        </div>}
      </Card>
    </div>
    <Card title="Phiên sạc của tôi"><DataTable rows={sessions.data ?? []} label="Phiên sạc của tôi" empty="Chưa có phiên sạc." columns={[
      { label:'Xe', value:(session) => <><strong>{session.vehicleId}</strong><div className="small muted">{session.private ? 'Xe cá nhân' : 'Xe dùng chung'}</div></> },
      { label:'Hub và cổng', value:(session) => <>{hubName(hubs.data ?? [],session.hubId)}<div className="small muted">{session.pointId ?? 'Chưa cấp cổng'}</div></> },
      { label:'Giờ sạc', value:(session) => <DateTime value={session.startAt} /> },
      { label:'Pin', value:(session) => `${session.currentPercent}% → ${session.targetPercent}%` },
      { label:'Trạng thái', value:(session) => <Badge value={session.status} /> },
      { label:'Thao tác', value:(session) => ['Scheduled','Waiting','Starting','Charging'].includes(session.status) ? <Button compact disabled={action.busy} onClick={() => { void stop(session); }}>Dừng sạc</Button> : '—' },
    ]} /></Card>
  </>;
}

export function StudentHistory({ revision }: PageProps) {
  const notifications = useResource<Notification[]>('/me/notifications',revision);
  const reservations = useResource<ReservationView[]>('/me/reservations',revision);
  const invoices = useResource<Invoice[]>('/me/invoices',revision);
  const trips = useResource<TripView[]>('/me/trips',revision);
  return <>
    <ResourceStatus resources={[notifications,reservations,invoices,trips]} />
    <div className="grid-2">
      <Card title="Thông báo"><DataTable rows={notifications.data ?? []} label="Thông báo cá nhân" empty="Bạn chưa có thông báo." columns={[
        { label:'Nội dung', value:(item) => item.message }, { label:'Thời điểm', value:(item) => <DateTime value={item.createdAt} /> },
      ]}/></Card>
      <Card title="Hóa đơn"><DataTable rows={invoices.data ?? []} label="Hóa đơn của tôi" empty="Chưa có hóa đơn." columns={[
        { label:'Chuyến đi', value:(item) => item.tripId }, { label:'Tổng tiền', value:(item) => money(item.amountVnd) }, { label:'Thời điểm', value:(item) => <DateTime value={item.createdAt} /> },
      ]}/></Card>
    </div>
    <div className="grid-2">
      <Card title="Lịch sử đặt xe">{reservations.data?.length ? <DataTable rows={reservations.data} label="Lượt đặt xe" empty="Chưa có lượt đặt xe." columns={[
        { label:'Xe', value:(item) => item.vehicleId }, { label:'Trạng thái', value:(item) => <Badge value={item.status} /> },
      ]}/> : <Empty>Chưa có lượt đặt xe.</Empty>}</Card>
      <Card title="Lịch sử chuyến đi"><DataTable rows={trips.data ?? []} label="Chuyến đi của tôi" empty="Chưa có chuyến đi." columns={[
        { label:'Xe', value:(item) => item.vehicleId }, { label:'Bắt đầu', value:(item) => <DateTime value={item.startedAt} /> }, { label:'Kết thúc', value:(item) => <DateTime value={item.endedAt} /> },
      ]}/></Card>
    </div>
  </>;
}
