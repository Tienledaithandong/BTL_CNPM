import { useState } from 'react';
import type { Alert, Command, Point, Slot } from '../api/types';
import type { HubView, VehicleView } from './client';
import { mutate, useAction, useResource } from './client';
import { Badge, Card, DateTime, Field } from './ui';
import { Button, DataTable, Feedback, HubField, ResourceStatus, hubName } from './components';

type Demo = { commands:Command[]; hubs:HubView[]; points:Point[]; slots?:Slot[]; vehicles:VehicleView[]; autoAck:boolean; pausedHubs:string[]; recoveryReason?: string | null };

export function OperatorDemo({ revision, refresh }: { revision:number; refresh:() => void }) {
  const demo = useResource<Demo>('/operator/demo/events',revision);
  const alerts = useResource<Alert[]>('/operator/alerts',revision);
  const [hub, setHub] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [occupied, setOccupied] = useState(14);
  const [battery, setBattery] = useState(45);
  const [point, setPoint] = useState('');
  const [plugVehicle, setPlugVehicle] = useState('');
  const [returnVehicle, setReturnVehicle] = useState('');
  const [returnHub, setReturnHub] = useState('');
  const [returnSlot, setReturnSlot] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [recoverConfirm, setRecoverConfirm] = useState(false);
  const action = useAction(refresh);
  const input = (kind:string, values:Record<string,unknown>, message:string) => action.run(() => mutate('/operator/demo/events',{kind,...values}),message);
  const ready = !!demo.data && !action.busy;
  const recovering = !!demo.data?.recoveryReason;
  const pending = (demo.data?.commands ?? []).filter((command) => command.status==='Pending');
  const vehicleSelect = (label:string, value:string, onChange:(value:string)=>void, options:VehicleView[]) => <Field label={label}>
    <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Chọn xe</option>{options.map((item) => <option key={item.id} value={item.id}>{item.id} · {hubName(demo.data?.hubs ?? [],item.hubId)}</option>)}</select>
  </Field>;
  return <>
    <ResourceStatus resources={[demo,alerts]} />
    <Feedback feedback={action.feedback} />
    {recovering && <Card title="Phục hồi dữ liệu" subtitle={demo.data?.recoveryReason ?? undefined}>
      <label className="checkbox"><input type="checkbox" checked={recoverConfirm} onChange={(event) => setRecoverConfirm(event.target.checked)} /> Tôi đã đối soát các lệnh thiết bị và trạng thái cần phục hồi.</label>
      <div><Button disabled={!ready || !recoverConfirm} onClick={() => { void input('recover',{ confirm:true },'Đã xác nhận phục hồi.'); }}>Hoàn tất phục hồi</Button></div>
    </Card>}
    <Card title="Lệnh thiết bị mô phỏng" extra={demo.data && <Badge value={demo.data.autoAck ? 'Healthy' : 'Unknown'} />}>
      <div className="actions"><Button disabled={!ready || recovering} onClick={() => { void input('autoAck',{enabled:!demo.data?.autoAck},'Đã cập nhật chế độ phản hồi thiết bị.'); }}>
        {demo.data?.autoAck ? 'Tạm dừng ACK tự động' : 'Bật ACK tự động'}</Button></div>
      <DataTable rows={pending} label="Lệnh đợi thiết bị" empty="Không có lệnh chờ phản hồi." columns={[
        { label:'Lệnh', value:(item) => item.id },
        { label:'Loại', value:(item) => item.type==='UNLOCK' ? 'Mở khóa' : item.type==='CHARGE_START' ? 'Cấp điện' : 'Ngắt điện' },
        { label:'Tài nguyên', value:(item) => item.resourceId },
        { label:'Đã gửi lúc', value:(item) => <DateTime value={item.dispatchedAt} /> },
        { label:'Phản hồi', value:(item : Command) => <div className="actions">
          <Button compact disabled={!ready || item.dispatchedAt===null} tone="primary" onClick={() => { void input('ack',{commandId:item.id,success:true},'Đã ghi nhận ACK thành công.'); }}>ACK thành công</Button>
          <Button compact disabled={!ready || item.dispatchedAt===null} tone="danger" onClick={() => { void input('ack',{commandId:item.id,success:false},'Đã gửi ACK lỗi.'); }}>ACK lỗi</Button>
        </div> },
      ]} />
    </Card>
    <div className="grid-2">
      <Card title="Tín hiệu từ hub">
        <HubField value={hub} onChange={setHub} hubs={demo.data?.hubs ?? []} />
        <div><Button disabled={!ready || !hub || recovering} onClick={() => {
          const paused = !demo.data?.pausedHubs.includes(hub);
          void input('heartbeat',{hubId:hub,paused},paused ? 'Đã dừng tín hiệu định kỳ của hub.' : 'Đã khôi phục tín hiệu định kỳ.');
        }}>{demo.data?.pausedHubs.includes(hub) ? 'Khôi phục tín hiệu' : 'Dừng tín hiệu'}</Button></div>
      </Card>
      <Card title="Chiếm dụng bãi đỗ" subtitle="Dữ liệu mẫu có 15 chỗ mỗi hub. Dùng 14 chỗ để mở cảnh báo hoặc 12 chỗ để thử đóng cảnh báo.">
        <HubField label="Hub bãi đỗ" value={hub} onChange={setHub} hubs={demo.data?.hubs ?? []} />
        <Field label="Số chỗ đang chiếm"><input type="number" min={0} step={1} value={Number.isFinite(occupied) ? occupied : ''} onChange={(event) => setOccupied(event.target.valueAsNumber)} /></Field>
        <div><Button disabled={!ready || !hub || recovering || !Number.isInteger(occupied) || occupied < 0} onClick={() => { void input('parking-fixture',{hubId:hub,occupied},'Đã ghi nhận chiếm dụng bãi đỗ.'); }}>Cập nhật chiếm dụng</Button></div>
      </Card>
      <Card title="Mức pin xe">
        {vehicleSelect('Xe',vehicle,setVehicle,demo.data?.vehicles ?? [])}
        <Field label="Pin mới (%)"><input type="number" min={0} max={100} step={1} value={Number.isFinite(battery) ? battery : ''} onChange={(event) => setBattery(event.target.valueAsNumber)} /></Field>
        <div><Button disabled={!ready || !vehicle || recovering || !(battery>=0 && battery<=100)} onClick={() => { void input('battery',{vehicleId:vehicle,batteryPercent:battery},'Đã cập nhật telemetry pin.'); }}>Cập nhật pin</Button></div>
      </Card>
      <Card title="Kết nối cổng sạc">
        <Field label="Cổng"><select value={point} onChange={(event) => setPoint(event.target.value)}><option value="">Chọn cổng</option>{(demo.data?.points ?? []).map((item) => <option key={item.id} value={item.id}>{item.id} · {hubName(demo.data?.hubs ?? [],item.hubId)}</option>)}</select></Field>
        {vehicleSelect('Xe dùng chung để cắm sạc',plugVehicle,setPlugVehicle,(demo.data?.vehicles ?? []).filter((item) => item.hubId===demo.data?.points.find((p) => p.id===point)?.hubId))}
        <div className="actions">
          <Button disabled={!ready || !point || !plugVehicle || recovering} onClick={() => { void input('plug',{pointId:point,vehicleId:plugVehicle},'Đã ghi nhận cắm sạc.'); }}>Ghi nhận cắm</Button>
          <Button disabled={!ready || !point || recovering} onClick={() => { void input('plug',{pointId:point,vehicleId:null},'Đã ghi nhận rút kết nối.'); }}>Ghi nhận rút</Button>
        </div>
      </Card>
      <Card title="Tín hiệu trả xe" subtitle="Dùng trong demo khi tắt xác nhận tự động.">
        {vehicleSelect('Xe đang trong chuyến',returnVehicle,setReturnVehicle,(demo.data?.vehicles ?? []).filter((item) => item.mobilityStatus==='InUse'))}
        <HubField value={returnHub} onChange={setReturnHub} hubs={demo.data?.hubs ?? []} />
        <Field label="Mã chỗ đỗ đích"><input value={returnSlot} onChange={(event) => setReturnSlot(event.target.value)}/></Field>
        <div><Button disabled={!ready || !returnVehicle || !returnHub || !returnSlot.trim() || recovering} onClick={() => { void input('returnEvidence',{vehicleId:returnVehicle,hubId:returnHub,slotId:returnSlot},'Đã ghi nhận xe có mặt và khóa ở chỗ đỗ.'); }}>Xác nhận xe đã khóa</Button></div>
      </Card>
    </div>
    <Card title="Đặt lại dữ liệu demo" subtitle="Khôi phục bộ dữ liệu mẫu và xóa các thao tác đã thực hiện trong phiên demo.">
      <label className="checkbox"><input type="checkbox" checked={resetConfirm} onChange={(event) => setResetConfirm(event.target.checked)} /> Tôi xác nhận đặt lại dữ liệu mẫu.</label>
      <div><Button tone="danger" disabled={!ready || !resetConfirm || recovering} onClick={() => {
        void input('reset',{confirm:true},'Đã khôi phục dữ liệu mẫu.').then((data) => { if (data) setResetConfirm(false); });
      }}>Đặt lại dữ liệu mẫu</Button></div>
    </Card>
  </>;
}
