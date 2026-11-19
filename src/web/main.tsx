import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Account } from './client';
import { ApiError, api, errorText, mutate, resetRetryState, useConnection, useResource } from './client';
import { Button, Feedback } from './components';
import { Badge, Brand, Circuit, Icon } from './ui';
import type { IconName } from './ui';
import { StudentMap, StudentRides, StudentParking, StudentCharging, StudentHistory } from './student';
import type { StudentPage } from './student';
import { OperatorOverview, OperatorAlerts, OperatorIncidents, OperatorRedistribution, OperatorPlans } from './operator';
import type { OperatorPage } from './operator';
import { OperatorScenarios } from './scenarios';
import { OperatorDemo } from './demo';
import './style.css';

type Page = StudentPage | OperatorPage;
type PageLink = { id:Page; label:string; description:string; icon:IconName };
const studentPages: PageLink[] = [
  { id:'map', label:'Hub và xe', description:'Tìm điểm nhận xe và chọn chỗ trả trong mạng lưới.', icon:'map' },
  { id:'rides', label:'Chuyến đi', description:'Xem lượt đặt, nhận xe và xác nhận trả xe.', icon:'bike' },
  { id:'parking', label:'Đỗ xe cá nhân', description:'Đặt chỗ theo khung giờ hoặc theo lịch lặp.', icon:'parking' },
  { id:'charging', label:'Sạc xe', description:'Yêu cầu sạc xe dùng chung hoặc đặt lịch cho xe cá nhân.', icon:'plug' },
  { id:'history', label:'Lịch sử của tôi', description:'Xem thông báo, lượt đặt xe, chuyến đi và hóa đơn.', icon:'calendar' },
];
const operatorPages: PageLink[] = [
  { id:'overview', label:'Tổng quan', description:'Theo dõi khả dụng của các hub và tài nguyên.', icon:'dashboard' },
  { id:'alerts', label:'Cảnh báo', description:'Theo dõi và tiếp nhận cảnh báo từ hệ thống.', icon:'bell' },
  { id:'incidents', label:'Sự cố', description:'Ghi nhận, cô lập và phục hồi tài nguyên.', icon:'alert' },
  { id:'redistribution', label:'Điều phối xe', description:'Lập và theo dõi lệnh chuyển xe giữa các hub.', icon:'route' },
  { id:'plans', label:'Lịch sạc', description:'Kiểm tra công suất và thứ tự ưu tiên trước khi áp dụng lịch.', icon:'calendar' },
  { id:'scenarios', label:'Mô phỏng What-if', description:'So sánh các kịch bản với bản chụp mạng lưới.', icon:'chart' },
  { id:'demo', label:'Điều khiển demo', description:'Gửi tín hiệu thiết bị và đặt lại dữ liệu trình diễn.', icon:'sliders' },
];
const accounts = [
  { id:'STUDENT_A', name:'Sinh viên A' },
  { id:'STUDENT_B', name:'Sinh viên B' },
  { id:'OPERATOR_A', name:'Điều phối viên' },
];
const nameOf = (id: string) => accounts.find((entry) => entry.id===id)?.name ?? id;

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
    <section className="login-message"><Brand/><div><h1>Di chuyển xanh trong khu đô thị.</h1><p>Tìm xe, đặt chỗ và sạc tại các hub trong khu đô thị ĐHQG-HCM.</p></div>
      <small>ĐHQG-HCM · Môi trường trình diễn</small><Circuit /></section>
    <section className="login-panel" aria-labelledby="login-heading"><div className="login-panel-inner">
      <div><h2 id="login-heading">Đăng nhập</h2><p className="muted">Chọn tài khoản để mở giao diện trình diễn.</p></div>
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

function Workspace({ account, onLogout }: { account:Account; onLogout:()=>void }) {
  const operator = account.role === 'OPERATOR';
  const links = operator ? operatorPages : studentPages;
  const [page, setPage] = useState<Page>(() => links.find((link) => link.id===new URLSearchParams(window.location.search).get('view'))?.id ?? links[0].id);
  const [revision, setRevision] = useState(0);
  const [logoutError, setLogoutError] = useState('');
  const refresh = useCallback(() => setRevision((value) => value+1), []);
  const connected = useConnection(true,refresh);
  const health = useResource<{status:string}>('/ready',revision);
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
    case 'overview':content=<OperatorOverview {...props} />;break;
    case 'alerts':content=<OperatorAlerts {...props} />;break;
    case 'incidents':content=<OperatorIncidents {...props} />;break;
    case 'redistribution':content=<OperatorRedistribution {...props} />;break;
    case 'plans':content=<OperatorPlans {...props} />;break;
    case 'scenarios':content=<OperatorScenarios {...props} />;break;
    case 'demo':content=<OperatorDemo {...props} />;break;
  }
  return <>
    <a className="skip" href="#workspace">Đến nội dung chính</a>
    <header className="app-header"><Brand/>
      <div className="header-actions">
        <span className={`badge ${connected ? 'ok' : 'warn'}`}>{connected ? 'Đang kết nối' : 'Đang đồng bộ lại'}</span>
        <span className="user-name">{nameOf(account.id)}</span>
        <Button compact onClick={() => { void logout(); }}><Icon name="exit" size={15} />Đăng xuất</Button>
      </div>
    </header>
    <div className="shell">
      <aside className="sidebar">
        <span className="side-label">{operator ? 'Vận hành' : 'Sinh viên'}</span>
        <nav className="side-nav" aria-label={operator ? 'Điều hướng vận hành' : 'Điều hướng sinh viên'}>
          {links.map((link) => <button type="button" key={link.id} aria-current={activeLink.id===link.id ? 'page' : undefined} className="side-link" onClick={() => navigate(link.id)}><Icon name={link.icon}/>{link.label}</button>)}
        </nav>
        <div className="sidebar-note">Dữ liệu mô phỏng · ĐHQG-HCM</div>
      </aside>
      <main className="workspace" id="workspace" tabIndex={-1}>
        <div className="page-heading"><div><div className="eyebrow">{operator ? 'Vận hành' : 'Sinh viên'}</div>
          <h1 id="page-title" tabIndex={-1}>{activeLink.label}</h1><p className="page-description">{activeLink.description}</p></div>
          <Button compact onClick={refresh}><Icon name="refresh" size={16}/>Tải lại</Button>
        </div>
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
