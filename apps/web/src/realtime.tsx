import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@office-service/shared';
import { api, sessionResponse } from './api';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';

type Status = 'connecting' | 'disconnected' | 'offline' | 'refreshing' | 'current' | 'suspended';
const RealtimeContext = createContext({ status: 'connecting' as Status, retry: () => {} });
const serverKeys = ['menu', 'orders', 'work-orders', 'users'];

export function Realtime({ user, children }: { user: PublicUser; children: ReactNode }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<Status>(navigator.onLine ? 'connecting' : 'offline');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let requested = false;
    let fullRefresh = false;
    const affected = new Set<string>();
    let checkSession = false;
    let resumeGrace: ReturnType<typeof setTimeout> | undefined;
    let wasLive = false;
    let connected = false;
    let authoritative = false;
    const scoped = (query: { queryKey: readonly unknown[] }) => serverKeys.includes(String(query.queryKey[0])) && query.queryKey[1] === user.id;
    const mark = (next: Status) => {
      if (!disposed) setStatus(!navigator.onLine ? 'offline' : document.hidden ? 'suspended' : next);
    };
    const reconcile = async (full: boolean, session = false, keys: string[] = []) => {
      requested = true;
      fullRefresh ||= full;
      checkSession ||= session;
      for (const key of keys) affected.add(key);
      if (running) return;
      running = true;
      try {
        while (requested && !disposed && navigator.onLine) {
          const refresh = fullRefresh || !authoritative;
          requested = false;
          fullRefresh = false;
          const verifySession = checkSession;
          checkSession = false;
          const keys = new Set(affected);
          affected.clear();
          if (refresh && !authoritative && connected && !resumeGrace) mark('refreshing');
          if (verifySession) {
            const result = await api('/auth/get-session', sessionResponse);
            if (disposed) break;
            const changed = !result.user || result.user.id !== user.id || result.user.role !== user.role
              || result.user.language !== user.language || result.user.mustChangePassword;
            if (changed) {
              source?.close();
              source = null;
              clearTimeout(watchdog);
              connected = false;
              await client.cancelQueries({ predicate: (query) => query.queryKey[0] === 'session' || scoped(query) });
              client.removeQueries({ predicate: scoped });
            }
            if (disposed) break;
            client.setQueryData(['session'], result);
            if (changed) break;
          }
          if (refresh || keys.size) {
            const predicate = (query: Parameters<typeof scoped>[0]) => scoped(query) && (refresh || keys.has(String(query.queryKey[0])));
            await client.cancelQueries({ predicate });
            if (disposed) break;
            await client.invalidateQueries({ predicate }, { throwOnError: true });
            if (refresh) authoritative = true;
          }
          if (connected && authoritative && !requested && navigator.onLine) {
            clearTimeout(resumeGrace);
            resumeGrace = undefined;
            mark('current');
          }
        }
      } catch {
        authoritative = false;
        clearTimeout(resumeGrace);
        resumeGrace = undefined;
        mark(navigator.onLine ? 'disconnected' : 'offline');
      }
      finally { running = false; }
    };
    const arm = () => {
      if (disposed) return;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        connected = false;
        source?.close();
        source = null;
        mark(navigator.onLine ? 'disconnected' : 'offline');
        if (navigator.onLine && !document.hidden) connect();
      }, 45000);
    };
    const connect = (quickResume = false) => {
      source?.close();
      clearTimeout(watchdog);
      connected = false;
      authoritative = false;
      if (disposed) return;
      if (!navigator.onLine) { mark('offline'); return; }
      if (document.hidden) { mark('suspended'); return; }
      if (quickResume) {
        mark('current');
        resumeGrace = setTimeout(() => {
          resumeGrace = undefined;
          mark(connected ? 'refreshing' : 'connecting');
        }, 1000);
      } else mark('connecting');
      const connection = new EventSource('/api/events');
      source = connection;
      const active = () => !disposed && source === connection;
      connection.addEventListener('ready', () => { if (active()) { connected = true; arm(); void reconcile(true, true); } });
      connection.addEventListener('change', (event) => {
        if (!active()) return;
        arm();
        let data: unknown;
        try { data = JSON.parse(event.data); } catch { data = null; }
        const kind = data && typeof data === 'object' && 'kind' in data ? data.kind : null;
        if (kind === 'order') void reconcile(false, false, ['orders', 'work-orders']);
        else if (kind === 'menu') void reconcile(false, false, ['menu']);
        else void reconcile(true, true);
      });
      connection.addEventListener('heartbeat', () => { if (active()) { arm(); void reconcile(false, true); } });
      connection.onerror = () => {
        if (!active()) return;
        connected = false;
        authoritative = false;
        clearTimeout(resumeGrace);
        resumeGrace = undefined;
        mark(navigator.onLine ? 'disconnected' : 'offline');
        void reconcile(false, true);
      };
      arm();
    };
    const offline = () => {
      clearTimeout(resumeGrace);
      resumeGrace = undefined;
      connected = false;
      source?.close();
      source = null;
      clearTimeout(watchdog);
      mark('offline');
    };
    const suspend = () => {
      wasLive = connected && authoritative;
      clearTimeout(resumeGrace);
      resumeGrace = undefined;
      connected = false;
      authoritative = false;
      source?.close();
      source = null;
      clearTimeout(watchdog);
      mark('suspended');
    };
    const resume = () => {
      if (disposed || document.hidden || !navigator.onLine) return;
      if (source && source.readyState !== EventSource.CLOSED) {
        if (connected && authoritative) mark('current');
        return;
      }
      connect(wasLive);
      wasLive = false;
    };
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('pagehide', suspend);
    document.addEventListener('visibilitychange', resume);
    connect();
    return () => {
      disposed = true;
      clearTimeout(resumeGrace);
      source?.close();
      clearTimeout(watchdog);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('pagehide', suspend);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [client, user.id, user.role, user.language, attempt]);
  return <RealtimeContext.Provider value={{ status, retry: () => setAttempt((value) => value + 1) }}>{children}</RealtimeContext.Provider>;
}

export function RealtimeStatus() {
  const { t } = useTranslation();
  const { status, retry } = useContext(RealtimeContext);
  return <div className="flex flex-wrap items-center gap-2" role="status" data-realtime={status}>
    <Badge variant="outline">{t('realtime.' + status)}</Badge>{(status === 'disconnected' || status === 'offline') && <Button variant="ghost" onClick={retry}>{t('retry')}</Button>}
  </div>;
}

function subscribeNetwork(notify: () => void) {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}
export function useOffline() { return useSyncExternalStore(subscribeNetwork, () => !navigator.onLine); }
