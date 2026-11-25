import { useEffect, useRef, useState } from 'react';
import { parseTimestamp } from '../api/time-format';
import type { Hub, Reservation, Trip, Hold, Vehicle, Point } from '../api/types';

export type Account = { id: string; role: 'STUDENT' | 'OPERATOR'; name?: string };
export type HubView = Hub & {
  availableVehicles: number; availableSlots: number; availablePoints: number; totalSlots: number;
  occupiedSlots: number; parkingOccupancyPct: number | null; powerInUseKW: number; openAlerts: number; stale: boolean;
  points?: Array<Pick<Point, 'id'|'hubId'|'connectorType'|'ratedKW'|'blocked'>>;
};
export type VehicleView = Omit<Vehicle, 'allocationOwner'> & Pick<Partial<Vehicle>, 'allocationOwner'> & { eligible: boolean; reason?: string | null };
export type ReservationView = Reservation & { hold: Hold | null; canPickup: boolean; pickupReason: string | null; needsReconciliation: boolean };
export type TripView = Trip & { hold: Hold | null };

type ApiResponse<T> = { data: T; stateVersion: number; requestId: string } | { error: { code: string; message: string; details?: unknown }; requestId: string };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  let result: ApiResponse<T>;
  try { result = JSON.parse(await response.text(), parseTimestamp) as ApiResponse<T>; }
  catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Máy chủ không trả dữ liệu mong đợi. Hãy kiểm tra kết nối và thử lại.');
  }
  if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('hub:expired'));
  if (!response.ok || 'error' in result) {
    if ('error' in result) throw new ApiError(response.status, result.error.code, result.error.message, result.error.details);
    throw new ApiError(response.status, 'REQUEST_FAILED', 'Thao tác chưa thực hiện được.');
  }
  return result.data;
}

const uncertainMutationIds = new Map<string, string>();
export function resetRetryState() { uncertainMutationIds.clear(); }

export async function mutate<T>(path: string, input: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const key = `${method} ${path} ${JSON.stringify(input)}`;
  const requestId = uncertainMutationIds.get(key) ?? crypto.randomUUID();
  uncertainMutationIds.set(key, requestId);
  try {
    const data = await api<T>(path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId }, body: JSON.stringify({ ...input, requestId }) });
    uncertainMutationIds.delete(key);
    return data;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) uncertainMutationIds.delete(key);
    throw error;
  }
}

export const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'Không kết nối được với máy chủ. Dữ liệu nhập vẫn được giữ.';

export function useResource<T>(path: string | null, revision: number) {
  const [result, setResult] = useState<{ path: string | null; data: T | null; error: string; pending: boolean }>({ path, data: null, error: '', pending: !!path });
  useEffect(() => {
    if (!path) return;
    const signal = new AbortController();
    setResult((previous) => ({ path, data: previous.path === path ? previous.data : null, pending: true, error: '' }));
    void api<T>(path, { signal: signal.signal }).then(
      (data) => { if (!signal.signal.aborted) setResult({ path, data, error: '', pending: false }); },
      (error: unknown) => {
        if (!signal.signal.aborted) setResult((previous) => ({ path, data: previous.path === path ? previous.data : null, error: errorText(error), pending: false }));
      },
    );
    return () => signal.abort();
  }, [path, revision]);
  if (!path || result.path !== path) return { data: null, pending: !!path, error: '' };
  return result;
}

export type FeedbackState = { kind: 'info' | 'ok' | 'error'; text: string };

export function useAction(refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind:'info', text: '' });
  const inflight = useRef(false);
  async function run<T>(task: () => Promise<T>, message?: string): Promise<T | undefined> {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setFeedback({ kind:'info', text:'' });
    try {
      const data = await task();
      if (message) {
        setFeedback({ kind:'ok', text:message });
        refresh();
      }
      return data;
    } catch(error) {
      setFeedback({ kind:'error', text:errorText(error) });
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') refresh();
      return undefined;
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return { busy, feedback, run, setFeedback };
}

export function useConnection(active: boolean, refresh: () => void) {
  const [connected, setConnected] = useState(false);
  const ref = useRef(refresh);
  useEffect(() => { ref.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    function scheduleRefresh() {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => { refreshTimer = undefined; if (!stopped) ref.current(); }, 180);
    }
    function connect() {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      let lastVersion = -1;
      socket.onopen = () => { if (!stopped) { delay = 500; setConnected(true); scheduleRefresh(); } };
      socket.onmessage = (event) => {
        let message: { type?: string; stateVersion?: number };
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.type !== 'state.changed' || typeof message.stateVersion !== 'number' ||
            !Number.isSafeInteger(message.stateVersion) || message.stateVersion <= lastVersion) return;
        lastVersion = message.stateVersion;
        scheduleRefresh();
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 5000);
      };
    }
    connect();
    const refetchWhenActive = () => { if (document.visibilityState === 'visible') scheduleRefresh(); };
    const fallback = setInterval(() => { if (socket?.readyState !== WebSocket.OPEN) refetchWhenActive(); }, 5000);
    document.addEventListener('visibilitychange', refetchWhenActive);
    window.addEventListener('online', scheduleRefresh);
    return () => {
      stopped = true;
      clearInterval(fallback);
      clearTimeout(reconnectTimer);
      clearTimeout(refreshTimer);
      socket?.close();
      document.removeEventListener('visibilitychange', refetchWhenActive);
      window.removeEventListener('online', scheduleRefresh);
    };
  }, [active]);
  return active && connected;
}
