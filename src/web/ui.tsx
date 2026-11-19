import { cloneElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

const drawing = {
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  map: 'M9 3 3 6v15l6-3 6 3 6-3V3l-6 3zM9 3v15m6-12v15',
  bike: 'M7 18a3 3 0 1 1 0-6 3 3 0 1 1 0 6Zm10 0a3 3 0 1 1 0-6 3 3 0 1 1 0 6ZM7 15l4-8h2l4 8m-9 0h6l-3-5H8',
  parking: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 14V7h4a3 3 0 0 1 0 6H9',
  calendar: 'M4 6h16v15H4zM8 3v6m8-6v6M4 12h16',
  dashboard: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  bell: 'M5 17h14l-2-3V9A5 5 0 0 0 7 9v5zm5 3h4',
  alert: 'm10 4-8 14a1 1 0 0 0 1 2h18a1 1 0 0 0 1-2L14 4a2 2 0 0 0-4 0ZM12 9v4m0 3h.01',
  route: 'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  chart: 'M4 5v15h16M8 15l4-4 3 2 5-7',
  sliders: 'M5 4v16m7-16v16m7-16v16M2 8h6m1 8h6m1-6h6',
  exit: 'M10 3H5v18h5m5-14 5 5-5 5m-6-5h11',
  refresh: 'M20 10a8 8 0 1 0-2 8m2-13v5h-5',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  plug: 'M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6m0 0a6 6 0 0 1-6-6m6 6v4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-15v6l4 2',
} as const;

export type IconName = keyof typeof drawing;

export function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={drawing[name]} /></svg>;
}

export function Brand() {
  return <div className="brand"><span className="logo"><Icon name="bolt" size={21} /></span><span>Smart E-Mobility Hub</span></div>;
}

export function Circuit() {
  return <svg aria-hidden="true" className="circuit" viewBox="0 0 500 230" fill="none" preserveAspectRatio="xMidYMid slice">
    <g stroke="#97bcff" strokeWidth="1.5">
      <path d="m32 186 114-65 104 57 120-66 108 53M32 186l120 31 88-22m10-17 8-126 112 60 53-78m-277 87-9-73 121 4m-8 126 8 35m112-101 2 105" />
      <path opacity=".55" d="M3 125 137 48 75 12m350 21 71 12m-126 67 95-28" />
    </g>
    <g fill="#2458bc" stroke="#b2ccff" strokeWidth="3">
      <circle cx="32" cy="186" r="7"/><circle cx="146" cy="121" r="11"/><circle cx="250" cy="178" r="12"/>
      <circle cx="258" cy="52" r="12"/><circle cx="370" cy="112" r="14"/><circle cx="478" cy="165" r="7"/>
      <circle cx="137" cy="48" r="7"/><circle cx="423" cy="34" r="7"/>
    </g>
  </svg>;
}

export function Card({ title, subtitle, children, extra }: { title?: string; subtitle?: string; children: ReactNode; extra?: ReactNode }) {
  return <section className="card">{(title || extra) && <div className="card-header">{title && <h2>{title}</h2>}{extra}</div>}{subtitle && <p className="card-sub">{subtitle}</p>}{children}</section>;
}

export function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;
  return <div className="field"><label htmlFor={id}>{label}</label>{cloneElement(children,{ id })}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Stat({ icon, label, value, hint }: { icon: IconName; label: string; value: ReactNode; hint?: ReactNode }) {
  return <div className="stat"><div><div className="stat-icon"><Icon name={icon} size={17} /></div><div className="stat-label">{label}</div><div className="stat-number">{value}</div></div>{hint && <span className="small muted">{hint}</span>}</div>;
}

const statuses: Record<string, [string, string]> = {
  Available: ['Khả dụng','ok'], good: ['Tốt','ok'], Reserved: ['Đã giữ','info'], UnlockPending: ['Chờ xác nhận mở khóa','warn'],
  InUse: ['Đang sử dụng','info'], ChargingNeeded: ['Cần sạc','warn'], Charging: ['Đang sạc','info'], Maintenance: ['Bảo trì','error'], NeedsCharge: ['Cần sạc','warn'],
  Blocked: ['Bị chặn','error'], Empty: ['Trống','ok'], Occupied: ['Đang chiếm dụng','info'], NeedsClear: ['Chờ rút kết nối','warn'],
  Unknown: ['Chưa xác định','warn'], Stale: ['Mất cập nhật','warn'], Healthy: ['Bình thường','ok'],
  Waiting: ['Đang chờ','warn'], Scheduled: ['Đã lên lịch','info'], Starting: ['Đang xác nhận cấp điện','warn'],
  StopPending: ['Chờ xác nhận ngắt điện','warn'], Completed: ['Hoàn tất','ok'], Stopped: ['Đã dừng','info'],
  Cancelled: ['Đã hủy','error'], Expired: ['Hết hạn','warn'], Failed: ['Thất bại','error'], Rejected: ['Bị từ chối','error'],
  Proposed: ['Đề xuất','info'], Confirmed: ['Đã xác nhận','ok'], Allocated: ['Đã cấp tài nguyên','info'],
  InTransit: ['Đang di chuyển','info'], Arrived: ['Đã đến','ok'], NeedsOperatorAction: ['Cần điều phối viên xử lý','warn'],
  Dropped: ['Đã bỏ','warn'], Open: ['Đang mở','warn'], Reported: ['Đã báo cáo','warn'], Applied: ['Đã áp dụng','ok'], PartiallyCompleted: ['Hoàn tất một phần','warn'], Acknowledged: ['Đã tiếp nhận','info'], Resolved: ['Đã xử lý','ok'],
  Isolated: ['Đã cô lập','warn'], Restored: ['Đã phục hồi','ok'], Running: ['Đang chạy','info'], Delayed: ['Bị trễ','warn'],
};

export function Badge({ value }: { value: unknown }) {
  const key = typeof value === 'string' ? value : 'Unknown';
  const [label, tone] = statuses[key] ?? [key, ''];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function DateTime({ value }: { value: unknown }) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value)) return <>—</>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <>{String(value)}</>;
  return <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat('vi-VN', { timeZone:'Asia/Ho_Chi_Minh', dateStyle:'short', timeStyle:'short' }).format(date)}</time>;
}

export const money = (value: number) => new Intl.NumberFormat('vi-VN',{ style:'currency', currency:'VND' }).format(value);
