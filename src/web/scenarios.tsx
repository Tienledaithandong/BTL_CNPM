import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Run, Scenario, ScenarioConfig } from '../api/types';
import type { HubView } from './client';
import { mutate, useAction, useResource } from './client';
import { Badge, Card, DateTime, Empty, Field } from './ui';
import { Button, DataTable, Feedback, ResourceStatus, hubName } from './components';

const newConfig = (): ScenarioConfig => ({
  hubIds:[], startTime:null, endTime:null, durationMinutes:60, tripDemandPct:0, chargingDemandPct:0,
  blockedSlots:0, blockedSlotsByHub:{}, disabledPortsPct:0, concentrationPct:0, seed:42,
});

function displayWindow(config: ScenarioConfig) {
  if (config.startTime === undefined && config.endTime === undefined) return `${config.durationMinutes} phút`;
  return `${config.startTime ?? 'Khi chạy'} – ${config.endTime ?? 'cuối ngày'}`;
}
const labels: Record<string,string> = {
  servedTrips:'Lượt thuê đáp ứng', rejectedTrips:'Lượt thuê từ chối', peakParkingOccupancy:'Chiếm dụng đỗ cao nhất',
  waitingChargingMinutes:'Tổng phút đợi sạc', meanChargingWait:'Thời gian đợi sạc trung bình',
  waitingChargingCount:'Yêu cầu sạc còn chờ', energyDeliveredKWh:'Điện năng đã cấp (kWh)', affectedCount:'Cam kết bị ảnh hưởng',
};
type Metrics = Record<string,number|null>;
type Comparison = {
  engineVersion: string; baseline: {metrics:Metrics; rejectedByReason?:Record<string,number>};
  scenario: {metrics:Metrics; rejectedByReason?:Record<string,number>};
  delta: Metrics; recommendations: Array<{hubId:string;operation:string;detail:string;
    window?: { pointId:string; slotId:string; startAt:number; endAt:number; powerKW:number; energyKWh:number } }>;
  assumptions?: Record<string,unknown>;
};
const resultValue = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(value);

function RunCard({ run, hubs, scenarios }: { run: Run; hubs: HubView[]; scenarios: Scenario[] }) {
  const result = run.status === 'Completed' ? run.result as Comparison | null : null;
  return <Card title={scenarios.find((scenario) => scenario.id===run.scenarioId)?.name ?? run.scenarioId} extra={<Badge value={run.status} />}>
    <div className="small muted">Bản chụp #{run.snapshotVersion} · <DateTime value={run.createdAt} /></div>
    {run.status==='Running' && <p className="notice" role="status">Đang tính kết quả trên bản chụp.</p>}
    {run.error && <p className="notice" role="alert" data-kind="error">{run.error==='INTERRUPTED' ? 'Lượt chạy bị gián đoạn khi khởi động lại. Bạn có thể chạy lại kịch bản.' : run.error}</p>}
    {result && <>
      <DataTable rows={Object.keys(result.baseline.metrics).map((id) => ({ id, baseline:result.baseline.metrics[id], scenario:result.scenario.metrics[id], delta:result.delta[id] }))} label="So sánh What-if" empty="Không có chỉ số." columns={[
        { label:'Chỉ số', value:(row) => labels[row.id] ?? row.id },
        { label:'Cơ sở', value:(row) => resultValue(row.baseline) },
        { label:'Kịch bản', value:(row) => resultValue(row.scenario) },
        { label:'Chênh lệch', value:(row) => row.delta !== null && row.delta > 0 ? '+'+resultValue(row.delta) : resultValue(row.delta) },
      ]} />
      <h3>Khuyến nghị</h3>
      {result.recommendations.length ? <ul>{result.recommendations.map((item,i) => <li key={i}><strong>{hubName(hubs,item.hubId)}</strong> · {item.detail}
        {item.window && <div>{item.window.pointId} · Chỗ {item.window.slotId} · <DateTime value={item.window.startAt} /> – <DateTime value={item.window.endAt} />
          {' · '}{resultValue(item.window.powerKW)} kW · {resultValue(item.window.energyKWh)} kWh</div>}</li>)}</ul> : <p className="muted">Không có thay đổi cần khuyến nghị theo mô hình.</p>}
      {result.assumptions && <details><summary>Giả định của lần chạy</summary><ul>{Object.entries(result.assumptions).map(([key,value]) => <li key={key}>{key} · {String(value)}</li>)}</ul></details>}
    </>}
  </Card>;
}

export function OperatorScenarios({ revision, refresh }: { revision: number; refresh: () => void }) {
  const hubs = useResource<HubView[]>('/hubs',revision);
  const scenarios = useResource<Scenario[]>('/operator/scenarios',revision);
  const runs = useResource<Run[]>('/operator/runs',revision);
  const [selected, setSelected] = useState<Scenario>();
  const [name, setName] = useState('');
  const [config, setConfig] = useState(newConfig);
  const action = useAction(refresh);
  const edit = (scenario?: Scenario) => {
    setSelected(scenario);
    setName(scenario?.name ?? '');
    setConfig(scenario ? structuredClone(scenario.config) : newConfig());
  };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run(
      () => selected ? mutate<Scenario>(`/operator/scenarios/${selected.id}`,{name,config,expectedVersion:selected.version},'PATCH') : mutate<Scenario>('/operator/scenarios',{name,config}),
      'Đã lưu cấu hình kịch bản.',
    );
    if (result) edit(result);
  }
  const run = (scenario: Scenario) => action.run(() => mutate<Run>(`/operator/scenarios/${scenario.id}/runs`,{expectedVersion:scenario.version}), 'Đã gửi kịch bản để chạy trên bản chụp.');
  const selectedHubs = config.hubIds.map(id => hubs.data?.find(hub => hub.id === id)).filter(hub => hub !== undefined);
  const legacyBlockedSlots = selected?.legacyBlockedSlotsByHub;
  const setTime = (key: 'startTime' | 'endTime', value: string) => setConfig(prev => ({ ...prev, [key]: value || null }));
  const setNumber = (key: 'tripDemandPct' | 'chargingDemandPct' | 'disabledPortsPct' | 'concentrationPct', value: number) =>
    setConfig(prev => ({ ...prev, [key]: value }));
  const toggleHub = (hubId: string, checked: boolean) => setConfig(prev => {
    const hubIds = checked ? [...prev.hubIds, hubId] : prev.hubIds.filter(id => id !== hubId);
    const counts = prev.blockedSlotsByHub ?? legacyBlockedSlots;
    const blockedSlotsByHub = Object.fromEntries(hubIds.map(id => [id, counts?.[id] ?? 0]));
    return { ...prev, hubIds, blockedSlots: 0, blockedSlotsByHub };
  });
  const setBlockedSlots = (hubId: string, value: number) => setConfig(prev => ({
    ...prev, blockedSlots: 0, blockedSlotsByHub: { ...(prev.blockedSlotsByHub ?? legacyBlockedSlots), [hubId]: value },
  }));
  const numberValue = (value: number) => Number.isFinite(value) ? value : '';
  return <>
    <ResourceStatus resources={[hubs,scenarios,runs]} />
    <Feedback feedback={action.feedback} />
    <Card title={selected ? 'Sửa kịch bản' : 'Kịch bản mới'}
      extra={selected && <span className="small muted scenario-code">{selected.id}</span>}
      subtitle={selected ? 'Mô phỏng trên bản chụp mạng lưới để so sánh trước khi điều phối.' : 'Mã kịch bản được tạo khi bạn lưu.'}>
      <form onSubmit={(event) => { void save(event); }} className="stack">
        <Field label="Tên kịch bản"><input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <fieldset className="hub-options"><legend>Phạm vi áp dụng</legend><div className="row">{(hubs.data ?? []).map(hub => <label className="checkbox" key={hub.id}>
          <input type="checkbox" checked={config.hubIds.includes(hub.id)} onChange={event => toggleHub(hub.id, event.target.checked)} />{hub.name}
        </label>)}</div></fieldset>
        <div className="grid-2">
          <Field label="Giờ bắt đầu"><input type="time" value={config.startTime ?? ''} onChange={event => setTime('startTime', event.target.value)} /></Field>
          <Field label="Giờ kết thúc"><input type="time" value={config.endTime ?? ''} onChange={event => setTime('endTime', event.target.value)} /></Field>
        </div>
        <p className="small muted">Giờ Việt Nam. {config.startTime === undefined && config.endTime === undefined
          ? `Kịch bản này đang dùng thời lượng ${config.durationMinutes} phút. Nhập giờ để chuyển sang khung giờ.`
          : 'Bỏ trống giờ bắt đầu để tính từ lúc chạy, hoặc giờ kết thúc để tính đến hết ngày.'}</p>
        <section className="stack scenario-section">
          <h3>Nhu cầu</h3>
          <div className="grid-2">
            <Field label="Thay đổi nhu cầu sử dụng (%)"><input required type="number" min={-100} max={200} step="any" value={numberValue(config.tripDemandPct)} onChange={event => setNumber('tripDemandPct', event.target.valueAsNumber)} /></Field>
            <Field label="Thay đổi nhu cầu sạc (%)"><input required type="number" min={-100} max={200} step="any" value={numberValue(config.chargingDemandPct)} onChange={event => setNumber('chargingDemandPct', event.target.valueAsNumber)} /></Field>
          </div>
        </section>
        <section className="stack scenario-section">
          <h3>Tài nguyên Hub</h3>
          <div className="grid-2">
            <Field label="Mức tập trung phương tiện (%)"><input required type="number" min={-100} max={100} step="any" value={numberValue(config.concentrationPct)} onChange={event => setNumber('concentrationPct', event.target.valueAsNumber)} /></Field>
            <Field label="Tỷ lệ cổng sạc khả dụng (%)"><input required type="number" min={0} max={100} step="any" value={numberValue(Number((100 - config.disabledPortsPct).toFixed(10)))} onChange={event => setNumber('disabledPortsPct', 100 - event.target.valueAsNumber)} /></Field>
          </div>
          <p className="small muted">Mức tập trung điều chỉnh lượt xe về Hub được chọn đầu tiên{selectedHubs[0] ? ` (${selectedHubs[0].name})` : ''}.</p>
          {selectedHubs.length > 0 && <fieldset className="hub-options">
            <legend>Chỗ đỗ không khả dụng</legend>
            <div className="grid-2">{selectedHubs.map(hub => <div className="scenario-parking" key={hub.id}>
              <Field label={`Số chỗ đỗ không khả dụng tại ${hub.name}`}><input required type="number" min={0} max={hub.totalSlots} step={1}
                value={numberValue((config.blockedSlotsByHub ?? legacyBlockedSlots)?.[hub.id] ?? 0)} onChange={event => setBlockedSlots(hub.id, event.target.valueAsNumber)} /></Field>
              <span className="small muted">/ {hub.totalSlots} chỗ</span>
            </div>)}</div>
          </fieldset>}
        </section>
        <div className="actions"><Button tone="primary" type="submit" disabled={action.busy || !name.trim() || !config.hubIds.length}>Lưu kịch bản</Button>{selected && <Button disabled={action.busy} onClick={() => edit()}>Tạo kịch bản khác</Button>}</div>
      </form>
    </Card>
    <Card title="Kịch bản đã lưu"><DataTable rows={scenarios.data ?? []} label="Kịch bản mô phỏng" empty="Chưa có kịch bản." columns={[
      { label:'Mã kịch bản', value:(item) => <span className="scenario-code">{item.id}</span> },
      { label:'Kịch bản', value:(item) => item.name },
      { label:'Thời gian', value:(item) => displayWindow(item.config) },
      { label:'Phạm vi', value:(item) => item.config.hubIds.map((id) => hubName(hubs.data ?? [],id)).join(', ') },
      { label:'Thao tác', value:(item) => <div className="actions"><Button compact disabled={action.busy} onClick={() => edit(item)}>Chỉnh sửa</Button>
        <Button compact tone="primary" disabled={action.busy} onClick={() => { void run(item); }}>Chạy mô phỏng</Button></div> },
    ]} /></Card>
    {runs.data?.length ? <div className="stack">{[...runs.data].sort((a,b) => b.createdAt-a.createdAt).map((item) => <RunCard run={item} key={item.id} hubs={hubs.data ?? []} scenarios={scenarios.data ?? []} />)}</div> : <Empty>Chưa có kết quả mô phỏng.</Empty>}
  </>;
}
