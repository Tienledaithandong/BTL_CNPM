import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Run, Scenario, ScenarioConfig } from '../api/types';
import type { HubView } from './client';
import { mutate, useAction, useResource } from './client';
import { Badge, Card, DateTime, Empty, Field, Stat } from './ui';
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

function RunCard({ run, hubs, scenarios, onRun, onNavigate, busy }: {
  run: Run; hubs: HubView[]; scenarios: Scenario[]; onRun: (scenario: Scenario) => void;
  onNavigate: (page: 'redistribution' | 'plans') => void; busy: boolean;
}) {
  const scenario = scenarios.find(item => item.id === run.scenarioId);
  const result = run.status === 'Completed' ? run.result as Comparison | null : null;
  return <section className="stack simulation-result">
    <div className="row between"><div className="stack"><h2>{scenario?.name ?? run.scenarioId}</h2>
      <p className="small muted scenario-code">{run.id} · {run.scenarioId} · Bản chụp #{run.snapshotVersion} · <DateTime value={run.createdAt} /></p></div>
      <div className="actions"><Badge value={run.status} />{scenario && run.status !== 'Running' && <Button compact tone="primary" disabled={busy} onClick={() => onRun(scenario)}>Chạy lại</Button>}</div>
    </div>
    {run.status==='Running' && <p className="notice" role="status">Đang tính kết quả trên bản chụp.</p>}
    {run.error && <p className="notice" role="alert" data-kind="error">{run.error==='INTERRUPTED' ? 'Lượt chạy bị gián đoạn khi khởi động lại. Bạn có thể chạy lại kịch bản.' : run.error}</p>}
    {result && <>
      <div className="stats dashboard-stats">{['rejectedTrips','peakParkingOccupancy','waitingChargingCount','meanChargingWait'].map(key => {
        const suffix = key === 'peakParkingOccupancy' ? '%' : key === 'meanChargingWait' ? ' phút' : '';
        const display = (value: number | null | undefined) => value == null ? '—' : resultValue(value) + suffix;
        return <Stat key={key} label={labels[key]} value={display(result.scenario.metrics[key])} hint={`Cơ sở: ${display(result.baseline.metrics[key])}`} tone={(result.delta[key] ?? 0) > 0 ? 'error' : undefined} />;
      })}</div>
      <div className="simulation-grid">
      <Card title="So sánh chỉ số">
      <DataTable rows={Object.keys(result.baseline.metrics).map((id) => ({ id, baseline:result.baseline.metrics[id], scenario:result.scenario.metrics[id], delta:result.delta[id] }))} label="So sánh What-if" empty="Không có chỉ số." columns={[
        { label:'Chỉ số', value:(row) => labels[row.id] ?? row.id },
        { label:'Cơ sở', value:(row) => resultValue(row.baseline) },
        { label:'Kịch bản', value:(row) => resultValue(row.scenario) },
        { label:'Chênh lệch', value:(row) => row.delta !== null && row.delta > 0 ? '+'+resultValue(row.delta) : resultValue(row.delta) },
      ]} />
      {result.assumptions && <details><summary>Giả định của lần chạy</summary><ul>{Object.entries(result.assumptions).map(([key,value]) => <li key={key}>{key} · {String(value)}</li>)}</ul></details>}
      </Card>
      <Card title="Khuyến nghị vận hành" subtitle="Tham khảo kết quả trước khi quyết định điều phối.">
        {result.recommendations.length ? <div className="recommendations">{result.recommendations.map((item,i) => <article key={i}>
          <div className="row between"><strong>{hubName(hubs,item.hubId)}</strong>
            {item.operation === 'Redistribution' && <Button compact onClick={() => onNavigate('redistribution')}>Điều phối</Button>}
            {item.operation === 'ChargingWindow' && <Button compact onClick={() => onNavigate('plans')}>Lịch sạc</Button>}
          </div><p>{item.detail}</p>
          {item.window && <p className="small muted">{item.window.pointId} · Chỗ {item.window.slotId} · <DateTime value={item.window.startAt} /> – <DateTime value={item.window.endAt} />
            {' · '}{resultValue(item.window.powerKW)} kW · {resultValue(item.window.energyKWh)} kWh</p>}
        </article>)}</div> : <p className="muted">Không có thay đổi cần khuyến nghị theo mô hình.</p>}
      </Card></div>
    </>}
  </section>;
}

export function OperatorScenarios({ revision, refresh, onNavigate }: { revision: number; refresh: () => void; onNavigate: (page: 'redistribution' | 'plans') => void }) {
  const hubs = useResource<HubView[]>('/hubs',revision);
  const scenarios = useResource<Scenario[]>('/operator/scenarios',revision);
  const runs = useResource<Run[]>('/operator/runs',revision);
  const [selected, setSelected] = useState<Scenario>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [analysis, setAnalysis] = useState(() => new URLSearchParams(window.location.search).get('scenarioView') === 'analysis');
  const [runScenarioId, setRunScenarioId] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState(newConfig);
  const action = useAction(refresh);
  function switchView(next: boolean) {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('scenarioView', 'analysis');
    else url.searchParams.delete('scenarioView');
    window.history.replaceState(null, '', url);
    setAnalysis(next);
  }
  const edit = (scenario?: Scenario) => {
    setSelected(scenario);
    setName(scenario?.name ?? '');
    setConfig(scenario ? structuredClone(scenario.config) : newConfig());
    setEditorOpen(true);
    switchView(false);
  };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run(
      () => selected ? mutate<Scenario>(`/operator/scenarios/${selected.id}`,{name,config,expectedVersion:selected.version},'PATCH') : mutate<Scenario>('/operator/scenarios',{name,config}),
      'Đã lưu cấu hình kịch bản.',
    );
    if (result) setEditorOpen(false);
  }
  async function run(scenario: Scenario) {
    const result = await action.run(() => mutate<Run>(`/operator/scenarios/${scenario.id}/runs`,{expectedVersion:scenario.version}), 'Đã gửi kịch bản để chạy trên bản chụp.');
    if (result) { setRunScenarioId(scenario.id); switchView(true); }
  }
  const availableScenarios = scenarios.data ?? [];
  const scenarioToRun = availableScenarios.find(scenario => scenario.id === runScenarioId);
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
    <div className="section-tabs" role="group" aria-label="Chế độ kịch bản và mô phỏng">
      <button type="button" aria-pressed={!analysis} onClick={() => switchView(false)}>Kịch bản What-if</button>
      <button type="button" aria-pressed={analysis} onClick={() => switchView(true)}>Mô phỏng và phân tích</button>
    </div>
    <ResourceStatus resources={[hubs,scenarios,runs]} />
    <Feedback feedback={action.feedback} />
    {analysis ? <>
      <Card className="simulation-picker" title="Chọn kịch bản mô phỏng">
        <div className="simulation-picker-fields">
          <Field label="Kịch bản"><select value={runScenarioId} onChange={event => setRunScenarioId(event.target.value)}>
            <option value="">Chọn kịch bản đã lưu</option>{availableScenarios.map(scenario => <option key={scenario.id} value={scenario.id}>{scenario.id} · {scenario.name}</option>)}
          </select></Field>
          <Button tone="primary" disabled={!scenarioToRun || action.busy} onClick={() => { if (scenarioToRun) void run(scenarioToRun); }}>Chạy mô phỏng</Button>
        </div>
        {!availableScenarios.length && !scenarios.pending && <div><Button onClick={() => edit()}>Tạo kịch bản mới</Button></div>}
      </Card>
      {runs.data?.length ? <>
        <p className="notice">Đây là kết quả mô phỏng trên bản chụp mạng lưới.</p>
        {[...runs.data].sort((a,b) => b.createdAt-a.createdAt).map(item => <RunCard run={item} key={item.id} hubs={hubs.data ?? []} scenarios={availableScenarios} busy={action.busy} onRun={scenario => { void run(scenario); }} onNavigate={onNavigate} />)}
      </> : <Empty>Chưa có kết quả mô phỏng.</Empty>}
    </> : editorOpen ? <>
    <div className="scenario-heading"><h2>{selected ? 'Sửa kịch bản' : 'Tạo kịch bản mới'}</h2>
      <p className="muted small scenario-code">{selected ? selected.id : 'Mã kịch bản được tạo khi bạn lưu.'}</p></div>
    <Card className="scenario-editor">
      <form onSubmit={(event) => { void save(event); }} className="stack">
        <Field label="Tên kịch bản"><input required placeholder="Ví dụ: Mưa lớn giờ tan học" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <fieldset className="hub-options scope-options"><legend>Phạm vi áp dụng</legend><div className="row">{(hubs.data ?? []).map(hub => <label className="pill checkbox scope-pill" key={hub.id}>
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
            <Field label="Thay đổi nhu cầu sử dụng (%)" suffix="%" hint="Từ -100 đến 200. +100% là gấp đôi nhu cầu hiện tại."><input required type="number" min={-100} max={200} step="any" value={numberValue(config.tripDemandPct)} onChange={event => setNumber('tripDemandPct', event.target.valueAsNumber)} /></Field>
            <Field label="Thay đổi nhu cầu sạc (%)" suffix="%" hint="Từ -100 đến 200. -100% là không còn nhu cầu."><input required type="number" min={-100} max={200} step="any" value={numberValue(config.chargingDemandPct)} onChange={event => setNumber('chargingDemandPct', event.target.valueAsNumber)} /></Field>
          </div>
        </section>
        <section className="stack scenario-section">
          <h3>Tài nguyên Hub</h3>
          <div className="grid-2">
            <Field label="Mức tập trung phương tiện (%)" suffix="%"><input required type="number" min={-100} max={100} step="any" value={numberValue(config.concentrationPct)} onChange={event => setNumber('concentrationPct', event.target.valueAsNumber)} /></Field>
            <Field label="Tỷ lệ cổng sạc khả dụng (%)" suffix="%"><input required type="number" min={0} max={100} step="any" value={numberValue(Number((100 - config.disabledPortsPct).toFixed(10)))} onChange={event => setNumber('disabledPortsPct', 100 - event.target.valueAsNumber)} /></Field>
          </div>
          <p className="small muted">Mức tập trung điều chỉnh lượt xe về Hub được chọn đầu tiên{selectedHubs[0] ? ` (${selectedHubs[0].name})` : ''}.</p>
          <fieldset className="hub-options scope-options">
            <legend>Chỗ đỗ không khả dụng</legend>
            {selectedHubs.length ? <div className="grid-2">{selectedHubs.map(hub => <div className="scenario-parking" key={hub.id}>
              <Field label={`Số chỗ đỗ không khả dụng tại ${hub.name}`}><input required type="number" min={0} max={hub.totalSlots} step={1}
                value={numberValue((config.blockedSlotsByHub ?? legacyBlockedSlots)?.[hub.id] ?? 0)} onChange={event => setBlockedSlots(hub.id, event.target.valueAsNumber)} /></Field>
              <span className="small muted">/ {hub.totalSlots} chỗ</span>
            </div>)}</div> : <p className="small muted">Chọn Hub trong phạm vi áp dụng để nhập.</p>}
          </fieldset>
        </section>
        <div className="row between"><Button disabled={action.busy} onClick={() => setEditorOpen(false)}>Hủy</Button><Button tone="primary" type="submit" disabled={action.busy || !name.trim() || !config.hubIds.length}>Lưu kịch bản</Button></div>
      </form>
    </Card>
    </> : <>
    <div className="row between"><p className="muted">Tạo hoặc chỉnh sửa tình huống giả định trước khi chạy mô phỏng.</p>
      <Button tone="primary" disabled={action.busy} onClick={() => edit()}>Tạo kịch bản mới</Button></div>
    <Card className="scenario-list"><DataTable rows={availableScenarios} label="Kịch bản mô phỏng" empty="Chưa có kịch bản." columns={[
      { label:'Mã kịch bản', value:(item) => <span className="scenario-code">{item.id}</span> },
      { label:'Tên kịch bản', value:(item) => item.name },
      { label:'Phạm vi', value:(item) => item.config.hubIds.map((id) => hubName(hubs.data ?? [],id)).join(', ') },
      { label:'Khung giờ mô phỏng', value:(item) => displayWindow(item.config) },
      { label:'Thao tác', value:(item) => <div className="actions"><button className="text-button" type="button" disabled={action.busy} onClick={() => edit(item)}>Chỉnh sửa</button>
        <Button compact tone="primary" disabled={action.busy} onClick={() => { void run(item); }}>Chạy mô phỏng</Button></div> },
    ]} /></Card>
    </>}
  </>;
}
