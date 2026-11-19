import type { ReactNode } from 'react';
import type { HubView, FeedbackState } from './client';
import { Empty, Field } from './ui';

export function Feedback({ feedback }: { feedback: FeedbackState }) {
  return <div className="notice" role={feedback.kind === 'error' ? 'alert' : 'status'} data-kind={feedback.kind}>{feedback.text}</div>;
}

export function ResourceStatus({ resources }: { resources: Array<{ data: unknown; pending: boolean; error: string }> }) {
  const errors = [...new Set(resources.map((resource) => resource.error).filter(Boolean))];
  const initialLoading = resources.some((resource) => resource.pending && resource.data === null);
  return <>{errors.map((error) => <Feedback key={error} feedback={{ kind:'error', text:error }} />)}
    {initialLoading && <p role="status" className="notice">Đang tải dữ liệu…</p>}</>;
}

export function HubField({ hubs, value, onChange, label = 'Hub', exclude, required = true }: {
  hubs: HubView[]; value: string; onChange: (id: string) => void; label?: string; exclude?: string; required?: boolean;
}) {
  return <Field label={label}><select required={required} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Chọn hub</option>
    {hubs.filter((hub) => hub.id !== exclude).map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}
  </select></Field>;
}

export interface Column<T> { label: string; value: (row: T) => ReactNode }

export function DataTable<T extends { id: string }>({ rows, columns, empty, label }: {
  rows: T[]; columns: Column<T>[]; empty: string; label: string;
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return <div className="table-wrap"><table aria-label={label}><thead><tr>{columns.map((column) => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}>{columns.map((column) => <td key={column.label}>{column.value(row)}</td>)}</tr>)}</tbody></table></div>;
}

export function Button({ children, onClick, disabled, tone = '', compact = false, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'primary' | 'danger' | ''; compact?: boolean; type?: 'submit' | 'button';
}) {
  return <button type={type} className={`button ${tone} ${compact ? 'compact' : ''}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function isoInput(value: string) {
  return new Date(`${value}:00+07:00`).toISOString();
}

export function localInput(offsetMinutes = 0) {
  return new Date(Date.now() + (420 + offsetMinutes) * 60000).toISOString().slice(0,16);
}

export function hubName(hubs: HubView[], id: string | null | undefined) {
  return hubs.find((hub) => hub.id === id)?.name ?? id ?? '—';
}
