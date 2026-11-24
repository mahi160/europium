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
    let connected = false;
    let authoritative = false;
    const scoped = (query: { queryKey: readonly unknown[] }) => serverKeys.includes(String(query.queryKey[0])) && query.queryKey[1] === user.id;
    const mark = (next: Status) => {
      if (!disposed) setStatus(!navigator.onLine ? 'offline' : document.hidden ? 'suspended' : next);
    };
    const reconcile = async (full: boolean) => {
      requested = true;
      fullRefresh ||= full;
      if (running) return;
      running = true;
      try {
        while (requested && !disposed && navigator.onLine) {
          const refresh = fullRefresh || !authoritative;
          requested = false;
          fullRefresh = false;
          if (refresh) { authoritative = false; if (connected) mark('refreshing'); }
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
          if (refresh) {
            await client.cancelQueries({ predicate: scoped });
            if (disposed) break;
            await client.invalidateQueries({ predicate: scoped }, { throwOnError: true });
            authoritative = true;
          }
          if (connected && authoritative && !requested && navigator.onLine) mark('current');
        }
      } catch { authoritative = false; mark(navigator.onLine ? 'disconnected' : 'offline'); }
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
        void reconcile(false);
        if (navigator.onLine) connect();
      }, 45000);
    };
    const connect = () => {
      source?.close();
      clearTimeout(watchdog);
      connected = false;
      authoritative = false;
      if (disposed) return;
      if (!navigator.onLine) { mark('offline'); return; }
      if (document.hidden) { mark('suspended'); return; }
      mark('connecting');
      const connection = new EventSource('/api/events');
      source = connection;
      const active = () => !disposed && source === connection;
      connection.addEventListener('ready', () => { if (active()) { connected = true; arm(); void reconcile(true); } });
      connection.addEventListener('change', () => { if (active()) { arm(); void reconcile(true); } });
      connection.addEventListener('heartbeat', () => { if (active()) { arm(); void reconcile(false); } });
      connection.onerror = () => {
        if (!active()) return;
        connected = false;
        authoritative = false;
        mark(navigator.onLine ? 'disconnected' : 'offline');
        void client.invalidateQueries({ queryKey: ['session'] });
        void reconcile(false);
      };
      arm();
    };
    const offline = () => {
      connected = false;
      source?.close();
      source = null;
      clearTimeout(watchdog);
      mark('offline');
    };
    const suspend = () => {
      connected = false;
      authoritative = false;
      source?.close();
      source = null;
      clearTimeout(watchdog);
      mark('suspended');
    };
    const resume = () => {
      if (document.hidden) { suspend(); return; }
      connect();
      void reconcile(true);
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
    <Badge variant="outline">{t('realtime.' + status)}</Badge>{status !== 'current' && <Button variant="ghost" onClick={retry}>{t('retry')}</Button>}
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
