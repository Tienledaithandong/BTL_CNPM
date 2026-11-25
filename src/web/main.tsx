import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Alert, Notification } from '../api/types';
import type { Account, HubView, VehicleView } from './client';
import { ApiError, api, errorText, mutate, resetRetryState, useConnection, useResource } from './client';
import { Button, Feedback } from './components';
import { Brand, Icon } from './ui';
import { StudentMap, StudentRides, StudentParking, StudentCharging, StudentHistory } from './student';
import type { StudentPage } from './student';
import { OperatorOverview, OperatorAlerts, OperatorIncidents, OperatorRedistribution, OperatorPlans } from './operator';
import type { OperatorPage } from './operator';
import { OperatorScenarios } from './scenarios';
import { OperatorDemo } from './demo';
import operatorAlert from './assets/operator-alert.svg';
import studentAlert from './assets/student-alert.svg';
import navDot from './assets/operator-nav.svg';
import activeNavDot from './assets/operator-nav-active.svg';
import searchDot from './assets/operator-search.svg';
import liveDot from './assets/live-dot.svg';
import welcomeHalo from './assets/welcome-halo.svg';
import welcomeWheel from './assets/welcome-wheel.svg';
import welcomeStem from './assets/welcome-stem.svg';
import './style.css';

type Page = StudentPage | OperatorPage;
type PageLink = { id: Page; label: string; title?: string; description?: string };
const studentPages: PageLink[] = [
  { id:'map', label:'Hub và xe', description:'Tìm điểm nhận xe và chọn chỗ trả trong mạng lưới.' },
  { id:'rides', label:'Chuyến đi', description:'Xem lượt đặt, nhận xe và xác nhận trả xe.' },
  { id:'parking', label:'Đỗ xe cá nhân', description:'Đặt chỗ theo khung giờ hoặc theo lịch lặp.' },
  { id:'charging', label:'Sạc xe', description:'Yêu cầu sạc xe dùng chung hoặc đặt lịch cho xe cá nhân.' },
  { id:'history', label:'Lịch sử của tôi', description:'Xem thông báo, lượt đặt xe, chuyến đi và hóa đơn.' },
];
const operatorPages: PageLink[] = [
  { id:'overview', label:'Tổng quan', title:'Giám sát mạng lưới' },
  { id:'alerts', label:'Cảnh báo', title:'Trung tâm cảnh báo' },
  { id:'incidents', label:'Sự cố', title:'Sự cố & phiếu bảo trì' },
  { id:'redistribution', label:'Điều phối xe', title:'Điều phối phương tiện' },
  { id:'plans', label:'Lịch sạc', title:'Lịch sạc thông minh' },
  { id:'scenarios', label:'Mô phỏng What-if', title:'Kịch bản & Mô phỏng' },
  { id:'demo', label:'Điều khiển demo' },
];
const accounts = [
  { id:'STUDENT_A', name:'Sinh viên A' },
  { id:'STUDENT_B', name:'Sinh viên B' },
  { id:'OPERATOR_A', name:'Điều phối viên' },
];
const nameOf = (id: string) => accounts.find((entry) => entry.id===id)?.name ?? id;

function WelcomeArt() {
  return <svg className="welcome-art" viewBox="0 0 591.5 354.9" aria-hidden="true">
    <rect width="591.5" height="354.9" fill="var(--brand-tint)" />
    <image href={welcomeHalo} x="202.8" y="-101.4" width="338" height="338" />
    <rect y="287.3" width="591.5" height="67.6" fill="#3b82f6" opacity=".15" />
    <image href={welcomeWheel} x="118.3" y="219.7" width="74.36" height="74.36" />
    <image href={welcomeWheel} x="338" y="219.7" width="74.36" height="74.36" />
    <rect x="169" y="239.98" width="253.5" height="23.66" rx="11.83" fill="var(--brand)" />
    <image href={welcomeStem} x="392.92" y="114.07" width="33.8017" height="130.132" />
    <rect x="368.42" y="111.54" width="64.22" height="10.14" rx="5.07" fill="var(--brand-dark)" />
    <rect x="503.62" y="98.02" width="60.84" height="189.28" rx="16.9" fill="white" />
    <rect x="517.14" y="118.3" width="33.8" height="43.94" rx="6.76" fill="#16a34a" />
  </svg>;
}

function Login({ onLogin }: { onLogin:(value:Account)=>void }) {
  const [userId, setUserId] = useState('STUDENT_A');
  const [password, setPassword] = useState('demo');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    setPending(true);
    try {
      const data = await mutate<Account>('/auth/login',{userId,password});
      onLogin(data);
    } catch (problem) { setError(errorText(problem)); }
    finally { setPending(false); }
  }
  return <main className="login">
    <header className="login-header"><Brand /><a className="button" href="#login-heading">Đăng nhập</a></header>
    <section className="login-message"><div><h1>Tìm xe điện &amp; Hub gần bạn trong vài giây</h1><p>Tra cứu xe, giữ chỗ 15 phút và trả xe dễ dàng trong khu đô thị ĐHQG-HCM.</p></div><WelcomeArt /></section>
    <section className="login-panel" aria-labelledby="login-heading"><div className="login-panel-inner">
      <div><h2 id="login-heading" tabIndex={-1}>Đăng nhập</h2><p className="muted">Chọn tài khoản để vào hệ thống.</p></div>
      <div className="stack" aria-label="Tài khoản demo">
        {accounts.map((entry) => <button className="demo-choice" key={entry.id} type="button" aria-pressed={userId===entry.id} onClick={() => { setUserId(entry.id); setPassword('demo'); }}>
          <span>{entry.name}</span><span className="small">{entry.id}</span>
        </button>)}
      </div>
      <form className="stack" onSubmit={(event) => { void login(event); }}>
        <label className="field"><span>Tài khoản</span><input required name="username" autoComplete="username" value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
        <label className="field"><span>Mật khẩu</span><input required name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <Feedback feedback={{ kind:'error',text:error }} />
        <Button type="submit" tone="primary" disabled={pending}>{pending ? 'Đang đăng nhập…' : 'Vào hệ thống'}</Button>
      </form>
    </div></section>
  </main>;
}

function OperatorSearch({ revision, onSelect }: { revision: number; onSelect: (hubId: string) => void }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase('vi');
  const hubs = useResource<HubView[]>(query ? '/hubs' : null, revision);
  const vehicles = useResource<VehicleView[]>(query ? '/vehicles' : null, revision);
  const results = query ? [
    ...(hubs.data ?? []).flatMap(hub => [{ key: hub.id, text: hub.name, hubId: hub.id },
      ...(hub.points ?? []).map(point => ({ key: point.id, text: `${point.id} · ${hub.name}`, hubId: hub.id }))]),
    ...(vehicles.data ?? []).flatMap(vehicle => vehicle.hubId ? [{ key: vehicle.id, text: `${vehicle.id} · ${vehicle.type}`, hubId: vehicle.hubId }] : []),
  ].filter(({key,text}) => `${key} ${text}`.toLocaleLowerCase('vi').includes(query)).slice(0,8) : [];
  return <form className="header-search" role="search" onSubmit={event => {
    event.preventDefault();
    if (results.length) { onSelect(results[0].hubId); setSearch(''); }
  }} onKeyDown={event => { if (event.key === 'Escape') setSearch(''); }}>
    <img src={searchDot} alt="" />
    <input type="search" aria-label="Tìm Hub, xe hoặc cổng sạc" placeholder="Tìm Hub, xe, trụ sạc…" value={search} onChange={event => setSearch(event.target.value)} />
    {query && <div className="header-search-results">
      {results.map(item => <button key={item.key} type="button" onClick={() => { onSelect(item.hubId); setSearch(''); }}>{item.text}</button>)}
      {!results.length && <p className="small muted">{hubs.pending || vehicles.pending ? 'Đang tìm…' : 'Không tìm thấy kết quả.'}</p>}
    </div>}
  </form>;
}

function Workspace({ account, onLogout }: { account:Account; onLogout:()=>void }) {
  const operator = account.role === 'OPERATOR';
  const links = operator ? operatorPages : studentPages;
  const [page, setPage] = useState<Page>(() => links.find((link) => link.id===new URLSearchParams(window.location.search).get('view'))?.id ?? links[0].id);
  const [revision, setRevision] = useState(0);
  const [focusHub, setFocusHub] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const refresh = useCallback(() => setRevision((value) => value+1), []);
  const connected = useConnection(true,refresh);
  const health = useResource<{status:string}>('/ready',revision);
  const alerts = useResource<Alert[]>(operator ? '/operator/alerts' : null, revision);
  const notifications = useResource<Notification[]>(operator ? null : '/me/notifications', revision);
  const alertCount = alerts.data?.filter(alert => alert.status === 'Open' && !alert.acknowledgedAt).length ?? 0;
  const hasUpdates = operator ? alertCount > 0 : notifications.data?.some(item => item.readAt === null);
  const activeLink = links.find((link) => link.id===page) ?? links[0];

  function navigate(id:Page) {
    setPage(id);
    const url = new URL(window.location.href);
    url.searchParams.set('view',id);
    window.history.replaceState(null,'',url);
    requestAnimationFrame(() => {
      document.getElementById('page-title')?.focus({preventScroll:true});
      window.scrollTo({top:0});
    });
  }
  async function logout() {
    setLogoutError('');
    try { await mutate('/auth/logout',{}); onLogout(); }
    catch(problem) { setLogoutError(errorText(problem)); }
  }
  const props = { revision,refresh };
  let content: ReactNode;
  switch(activeLink.id) {
    case 'map':content=<StudentMap {...props} onBooked={() => navigate('rides')} />;break;
    case 'rides':content=<StudentRides {...props} onMap={() => navigate('map')} />;break;
    case 'parking':content=<StudentParking {...props} />;break;
    case 'charging':content=<StudentCharging {...props} />;break;
    case 'history':content=<StudentHistory {...props} />;break;
    case 'overview':content=<OperatorOverview {...props} alerts={alerts.data ?? []} selectedHub={focusHub} onSelectHub={setFocusHub} onAlerts={() => navigate('alerts')} />;break;
    case 'alerts':content=<OperatorAlerts {...props} />;break;
    case 'incidents':content=<OperatorIncidents {...props} />;break;
    case 'redistribution':content=<OperatorRedistribution {...props} />;break;
    case 'plans':content=<OperatorPlans {...props} />;break;
    case 'scenarios':content=<OperatorScenarios {...props} onNavigate={navigate} />;break;
    case 'demo':content=<OperatorDemo {...props} />;break;
  }
  const navigation = <nav className="side-nav" aria-label={operator ? 'Điều hướng vận hành' : 'Điều hướng sinh viên'}>
    {links.map(link => <button type="button" key={link.id} aria-current={activeLink.id === link.id ? 'page' : undefined} className="side-link" onClick={() => navigate(link.id)}>
      {operator && <img src={activeLink.id === link.id ? activeNavDot : navDot} alt="" />}{link.label}
      {link.id === 'alerts' && alertCount > 0 && <span className="nav-count" aria-hidden="true">{alertCount}</span>}
    </button>)}
  </nav>;
  return <>
    <a className="skip" href="#workspace">Đến nội dung chính</a>
    <div className={`shell ${operator ? 'operator-shell' : 'student-shell'}`}>
      {operator && <aside className="sidebar"><div className="sidebar-inner"><Brand operator />{navigation}</div></aside>}
      <header className="app-header">
        {operator ? <><h1 id="page-title" tabIndex={-1}>{activeLink.title ?? activeLink.label}</h1>
          <OperatorSearch revision={revision} onSelect={id => { setFocusHub(id); navigate('overview'); }} /></> : <><Brand />{navigation}</>}
        <div className="header-actions">
          <span className={`badge connection ${connected ? 'ok' : 'warn'}`}>{connected && <img src={liveDot} alt="" />}{connected ? 'Đang kết nối' : 'Đang đồng bộ lại'}</span>
          <button type="button" className="header-alert" aria-label={operator ? 'Mở trung tâm cảnh báo' : 'Mở thông báo'} onClick={() => navigate(operator ? 'alerts' : 'history')}>
            {hasUpdates ? <img src={operator ? operatorAlert : studentAlert} alt="" /> : <Icon name="bell" size={20} />}
          </button>
          <details className="account-menu"><summary aria-label={`Tài khoản ${nameOf(account.id)}`}><span className="avatar" aria-hidden="true">{operator ? 'OP' : 'SV'}</span><span className="user-name">{nameOf(account.id)}</span></summary>
            <div className="account-actions">
              <Button compact onClick={refresh}><Icon name="refresh" size={16} />Tải lại</Button>
              <Button compact onClick={() => { void logout(); }}><Icon name="exit" size={15} />Đăng xuất</Button>
            </div>
          </details>
        </div>
      </header>
      <main className={`workspace workspace-${page}`} id="workspace" tabIndex={-1}>
        {!operator && <div className={`page-heading ${page === 'map' ? 'map-page-heading' : ''}`}><div>
          <h1 id="page-title" tabIndex={-1}>{activeLink.label}</h1><p className="page-description">{activeLink.description}</p>
        </div></div>}
        {health.error && <Feedback feedback={{kind:'error',text:health.error}}/>}
        {logoutError && <Feedback feedback={{kind:'error',text:logoutError}}/>}
        {content}
      </main>
    </div>
  </>;
}

function App() {
  const [account, setAccount] = useState<Account | null>();
  const [initialError, setInitialError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void api<Account>('/auth/me',{signal:controller.signal}).then(
      (data) => { if (!controller.signal.aborted) setAccount(data); },
      (error:unknown) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError && error.status===401)) setInitialError(errorText(error));
        setAccount(null);
      },
    );
    const onExpired = () => { resetRetryState(); setInitialError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); setAccount(null); };
    window.addEventListener('hub:expired',onExpired);
    return () => { controller.abort(); window.removeEventListener('hub:expired',onExpired); };
  }, []);
  if (account === undefined) return <main className="workspace"><p role="status">Đang xác thực phiên…</p></main>;
  if (!account) return <>
    {initialError && <Feedback feedback={{kind:'error',text:initialError}}/>}
    <Login onLogin={(user) => { resetRetryState(); setInitialError(''); setAccount(user); }}/>
  </>;
  return <Workspace account={account} onLogout={() => { resetRetryState(); setAccount(null); }} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Không tìm thấy phần tử giao diện.');
createRoot(root).render(<App/>);
