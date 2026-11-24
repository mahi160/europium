import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, sessionResponse } from '../api';
import { draftFor } from '../draft';
import { useOffline } from '../realtime';
import { Button } from './ui/button';

const noDraftSubscription = () => () => {};

export function PwaUpdate() {
  const { t } = useTranslation();
  const { data: session } = useQuery({ queryKey: ['session'], queryFn: () => api('/auth/get-session', sessionResponse) });
  const store = session?.user ? draftFor(session.user.id) : null;
  const hasDraft = () => {
    const draft = store?.getState();
    return !!draft && (draft.attempted !== null || draft.note !== '' || Object.values(draft.quantities).some((quantity) => quantity > 0));
  };
  const dirty = useSyncExternalStore(store?.subscribe ?? noDraftSubscription, hasDraft);
  const offline = useOffline();
  const waiting = useRef<ServiceWorker | null>(null);
  const [update, setUpdate] = useState<'waiting' | 'active' | null>(null);
  const [held, setHeld] = useState(false);

  function applyUpdate() {
    if (!session || !navigator.onLine) return;
    if (hasDraft() || document.querySelector('[data-slot="dialog-content"][data-open]')) {
      setHeld(true);
      return;
    }
    if (update === 'active') window.location.reload();
    else waiting.current?.postMessage('SKIP_WAITING');
  }
  const applyAutomaticUpdate = useEffectEvent(() => { if (update && !held) applyUpdate(); });
  useEffect(() => { applyAutomaticUpdate(); }, [update, session, held, offline]);

  useEffect(() => {
    const workers = navigator.serviceWorker;
    let controller = workers.controller;
    let active = true;
    let registration: ServiceWorkerRegistration | null = null;
    let installing: ServiceWorker | null = null;
    let checking = false;
    const installed = () => {
      if (!controller) return;
      const worker = registration?.waiting ?? (installing?.state === 'installed' ? installing : null);
      if (!worker) return;
      waiting.current = worker;
      setUpdate((current) => current ?? 'waiting');
    };
    const watch = () => {
      installing?.removeEventListener('statechange', installed);
      installing = registration?.installing ?? null;
      installing?.addEventListener('statechange', installed);
      installed();
    };
    const changed = () => {
      if (controller && workers.controller && controller !== workers.controller) setUpdate('active');
      controller = workers.controller;
    };
    const check = () => {
      if (!registration || checking || document.hidden || !navigator.onLine) return;
      checking = true;
      void registration.update().catch(() => {}).finally(() => { checking = false; });
    };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    workers.addEventListener('controllerchange', changed);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', restored);
    void workers.register('/sw.js').then((result) => {
      if (!active) return;
      registration = result;
      result.addEventListener('updatefound', watch);
      watch();
      check();
    }).catch(() => {});
    return () => {
      active = false;
      registration?.removeEventListener('updatefound', watch);
      installing?.removeEventListener('statechange', installed);
      workers.removeEventListener('controllerchange', changed);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', restored);
    };
  }, []);

  if (!held) return null;
  return <aside className="flex flex-wrap items-center gap-2 border-b bg-muted px-4 py-2">
    <p role="status">{t(dirty ? 'pwaUpdateDraft' : 'pwaUpdateReady')}</p>
    <Button type="button" variant="secondary" disabled={dirty || offline} onClick={() => { setHeld(false); applyUpdate(); }}>{t('pwaReload')}</Button>
  </aside>;
}
