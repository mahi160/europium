import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { pushConfigSchema, type PublicUser } from '@office-service/shared';
import { api, ApiError, successResponse } from '../api';
import { ErrorNotice } from './forms';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { useOffline } from '../realtime';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}
declare global { interface WindowEventMap { beforeinstallprompt: InstallPrompt } }
let pendingInstall: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); pendingInstall = event; });
window.addEventListener('appinstalled', () => { pendingInstall = null; });
const supported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function saveSubscription(subscription: PushSubscription) {
  const keys = subscription.toJSON().keys;
  await api('/push/subscription', successResponse, 'POST', { endpoint: subscription.endpoint, keys });
}
export function PwaSetup({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const offline = useOffline();
  const canPush = supported();
  const config = useQuery({ queryKey: ['push-config', user.id], queryFn: () => api('/push/config', pushConfigSchema), enabled: canPush });
  const publicKey = config.data?.publicKey;
  const [prompt, setPrompt] = useState<InstallPrompt | null>(pendingInstall);
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(supported() && Notification.permission === 'denied');
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const install = (event: InstallPrompt) => { event.preventDefault(); setPrompt(event); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', install);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('appinstalled', done); };
  }, []);
  useEffect(() => {
    if (!canPush || !publicKey || offline || Notification.permission !== 'granted') return;
    let active = true;
    void navigator.serviceWorker.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || !active) return;
      await saveSubscription(subscription);
      if (active) setEnabled(true);
    }).catch(() => {});
    return () => { active = false; };
  }, [canPush, offline, publicKey, user.id]);
  async function enable() {
    if (!canPush || !publicKey || offline || busy || !navigator.onLine) return;
    setError(null); setBusy(true);
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      setDenied(permission === 'denied');
      if (permission !== 'granted') return;
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new ApiError('PUSH_UNAVAILABLE');
      const ready = await navigator.serviceWorker.ready;
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (value) => value.charCodeAt(0));
      const subscription = await ready.pushManager.getSubscription() ?? await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await saveSubscription(subscription);
      setEnabled(true);
    } catch (cause) { setError(cause instanceof ApiError ? cause : new ApiError('PUSH_UNAVAILABLE')); }
    finally { setBusy(false); }
  }
  return <Card><CardHeader><CardTitle><h2>{t('pwaTitle')}</h2></CardTitle></CardHeader><CardContent className="grid gap-2">
    {(!canPush || denied || (!config.isPending && !publicKey) || enabled) && <p role="status">{t(!canPush ? 'pwaUnsupported' : denied ? 'pwaDenied' : !publicKey ? 'pwaUnavailable' : 'pwaEnabled')}</p>}
    {!enabled && canPush && !denied && publicKey && <Button variant="secondary" disabled={offline || busy} onClick={() => void enable()}>{t('pwaEnable')}</Button>}
    <ErrorNotice error={error ?? config.error}/>
    {installed ? <p>{t('pwaInstalled')}</p> : <Collapsible className="grid gap-4"><CollapsibleTrigger render={<Button variant="secondary"/>}>{t('pwaInstall')}</CollapsibleTrigger><CollapsibleContent className="grid gap-4">
      {prompt ? <Button variant="secondary" onClick={() => { void prompt.prompt().catch(() => setError(new ApiError('PUSH_UNAVAILABLE'))); pendingInstall = null; setPrompt(null); }}>{t('pwaInstall')}</Button> : <p>{t('pwaInstallHelp')}</p>}
      <p>{t('pwaIos')}</p>
    </CollapsibleContent></Collapsible>}
    <Collapsible className="grid gap-4"><CollapsibleTrigger render={<Button variant="secondary"/>}>{t('pwaRequirements')}</CollapsibleTrigger><CollapsibleContent><p>{t('pwaPrerequisites')}</p></CollapsibleContent></Collapsible>
  </CardContent></Card>;
}
