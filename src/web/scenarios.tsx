import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Run, Scenario, ScenarioConfig } from '../api/types';
import type { HubView } from './client';
import { mutate, useAction, useResource } from './client';
import { Badge, Card, DateTime, Empty, Field } from './ui';
import { Button, DataTable, Feedback, ResourceStatus, hubName } from './components';

const newConfig = (): ScenarioConfig => ({ hubIds:[], durationMinutes:60, tripDemandPct:0, chargingDemandPct:0, blockedSlots:0, disabledPortsPct:0, concentrationPct:0, seed:42 });
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
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState(newConfig);
  const action = useAction(refresh);
  const edit = (scenario?: Scenario) => {
    setSelected(scenario?.id ?? '');
    setName(scenario?.name ?? '');
    setConfig(scenario ? structuredClone(scenario.config) : newConfig());
  };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = scenarios.data?.find((scenario) => scenario.id===selected);
    const result = await action.run(
      () => current ? mutate<Scenario>(`/operator/scenarios/${current.id}`,{name,config,expectedVersion:current.version},'PATCH') : mutate<Scenario>('/operator/scenarios',{name,config}),
      'Đã lưu cấu hình kịch bản.',
    );
    if (result) edit(result);
  }
  const run = (scenario: Scenario) => action.run(() => mutate<Run>(`/operator/scenarios/${scenario.id}/runs`,{expectedVersion:scenario.version}), 'Đã gửi kịch bản để chạy trên bản chụp.');
  const setNumber = (key: Exclude<keyof ScenarioConfig,'hubIds'>) => (value: number) => setConfig((prev) => ({ ...prev,[key]:value }));
  const inputs: Array<{ key: Exclude<keyof ScenarioConfig,'hubIds'>; label:string; min:number; max?:number; step?:number }> = [
    {key:'durationMinutes', label:'Thời lượng (phút)',min:5,max:360,step:5},
    {key:'tripDemandPct',label:'Thay đổi nhu cầu thuê (%)',min:-100,max:100},
    {key:'chargingDemandPct',label:'Thay đổi nhu cầu sạc (%)',min:-100,max:100},
    {key:'blockedSlots',label:'Số chỗ đỗ bị chặn',min:0},
    {key:'disabledPortsPct',label:'Tỷ lệ cổng sạc bị tắt (%)',min:0,max:100},
    {key:'concentrationPct',label:'Tập trung chuyến về hub đầu tiên (%)',min:-100,max:100},
    {key:'seed',label:'Seed mô phỏng',min:1},
  ];
  return <>
    <ResourceStatus resources={[hubs,scenarios,runs]} />
    <Feedback feedback={action.feedback} />
    <Card title={selected ? 'Sửa kịch bản' : 'Kịch bản mới'} subtitle="Mô phỏng trên bản chụp mạng lưới để so sánh trước khi điều phối.">
      <form onSubmit={(event) => { void save(event); }} className="stack">
        <Field label="Tên kịch bản"><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <fieldset className="hub-options"><legend>Phạm vi hub</legend><div className="row">{(hubs.data ?? []).map((hub) => <label className="checkbox" key={hub.id}><input type="checkbox" checked={config.hubIds.includes(hub.id)} onChange={(event) => {
          const checked = event.target.checked;
          setConfig((prev) => ({...prev,hubIds:checked ? [...prev.hubIds,hub.id] : prev.hubIds.filter((id) => id!==hub.id)}));
        }}/>{hub.name}</label>)}</div></fieldset>
        <div className="triple">{inputs.map(({key,label,min,max,step}) => <Field key={key} label={label}><input required type="number" min={min} max={max} step={step ?? 1} value={Number.isFinite(config[key]) ? config[key] : ''} onChange={(event) => setNumber(key)(event.target.valueAsNumber)} /></Field>)}</div>
        <div className="actions"><Button tone="primary" type="submit" disabled={action.busy || !name.trim() || !config.hubIds.length}>Lưu kịch bản</Button>{selected && <Button onClick={() => edit()}>Tạo kịch bản khác</Button>}</div>
      </form>
    </Card>
    <Card title="Kịch bản đã lưu"><DataTable rows={scenarios.data ?? []} label="Kịch bản mô phỏng" empty="Chưa có kịch bản." columns={[
      { label:'Kịch bản', value:(item) => item.name },
      { label:'Thời lượng', value:(item) => `${item.config.durationMinutes} phút` },
      { label:'Phạm vi', value:(item) => item.config.hubIds.map((id) => hubName(hubs.data ?? [],id)).join(', ') },
      { label:'Thao tác', value:(item) => <div className="actions"><Button compact disabled={action.busy} onClick={() => edit(item)}>Chỉnh sửa</Button>
        <Button compact tone="primary" disabled={action.busy} onClick={() => { void run(item); }}>Chạy mô phỏng</Button></div> },
    ]} /></Card>
    {runs.data?.length ? <div className="stack">{[...runs.data].sort((a,b) => b.createdAt-a.createdAt).map((item) => <RunCard run={item} key={item.id} hubs={hubs.data ?? []} scenarios={scenarios.data ?? []} />)}</div> : <Empty>Chưa có kết quả mô phỏng.</Empty>}
  </>;
}
