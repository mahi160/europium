import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@office-service/shared';
import { api, sessionResponse, setupResponse, successResponse, userResponse } from '../api';
import { applyLanguage } from '../i18n';
import { Button } from '../components/ui/button';
import { ErrorNotice, Field, Form, Password, text } from '../components/forms';
import { People } from './people';
import { MenuManagement, MyOrders, Ordering } from './ordering';
import { clearDraft } from '../draft';
import { Work } from './work';
import { Realtime, RealtimeStatus, useOffline } from '../realtime';
import { PwaSetup, PushDevice } from '../components/pwa';

export function Mark() {
  return <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M8 14h17v8a8 8 0 0 1-17 0v-8Z" fill="currentColor"/><path d="M25 15h3a4 4 0 0 1 0 8h-3M5 31h26M14 5v4M20 3v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}
export function LanguagePicker({ user }: { user?: PublicUser }) {
  const { t, i18n } = useTranslation();
  const offline = useOffline();
  const client = useQueryClient();
  const [error, setError] = useState<Error | null>(null);
  return <div className="language"><label htmlFor="language" className="sr-only">{t('language')}</label><select id="language" disabled={!!user && offline} value={i18n.language} onChange={async (e) => {
    const language = e.target.value;
    setError(null);
    try {
      if (user) {
        const result = await api('/me', userResponse, 'PATCH', { language });
        client.setQueryData(['session'], result);
      }
      applyLanguage(language);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error()); }
  }}><option value="bn">বাংলা</option><option value="en">English</option></select><ErrorNotice error={error}/></div>;
}
export function Application() {
  const { t } = useTranslation();
  const offline = useOffline();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api('/setup', setupResponse) });
  const session = useQuery({ queryKey: ['session'], queryFn: () => api('/auth/get-session', sessionResponse) });
  const user = session.data?.user;
  const [logoutError, setLogoutError] = useState<Error | null>(null);
  async function logout() {
    setLogoutError(null);
    try {
      await api('/auth/logout', successResponse, 'POST', {});
      if (user) clearDraft(user.id);
      await client.cancelQueries();
      client.removeQueries({ predicate: (query) => !['session', 'setup'].includes(String(query.queryKey[0])) });
      client.setQueryData(['session'], { user: null });
      await navigate({ to: '/' });
    } catch (cause) { setLogoutError(cause instanceof Error ? cause : new Error()); }
  }
  useEffect(() => { if (user) applyLanguage(user.language); }, [user?.id, user?.language]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void client.invalidateQueries({ queryKey: ['session'] }); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [client]);
  if (setup.isPending || session.isPending) return <main className="auth"><p role="status" className="muted">{t('loading')}</p></main>;
  if ((setup.error && !setup.data) || (session.error && !session.data)) return <main className="auth"><ErrorNotice error={setup.error ?? session.error} retry={() => { void setup.refetch(); void session.refetch(); }} /></main>;
  if (!user) return <main className="auth"><header className="auth-header"><div className="brand"><Mark/>{t('app')}</div><LanguagePicker /></header><Auth setupRequired={setup.data?.setupRequired ?? false}/></main>;
  if (user.mustChangePassword) return <main className="auth"><header className="auth-header"><div className="brand"><Mark/>{t('app')}</div><Button variant="ghost" disabled={offline} onClick={() => void logout()}>{t('logout')}</Button></header><div className="auth-card"><PasswordForm required/><ErrorNotice error={logoutError}/></div></main>;
  const nav = [
    { to: '/', label: 'home' }, { to: '/orders', label: 'orders' }, { to: '/profile', label: 'profile' },
    ...(user.role === 'staff' || user.role === 'admin' ? [{ to: '/work', label: 'work' }] : []),
    ...(user.role === 'admin' ? [{ to: '/menu', label: 'menu' }, { to: '/users', label: 'users' }] : []),
  ];
  const title = nav.find((item) => item.to === location.pathname)?.label ?? 'home';
  const allowed = nav.some((item) => item.to === location.pathname);
  return <Realtime key={user.id + ':' + user.role + ':' + user.language} user={user}><PushDevice user={user}/><div className="app-shell">
    <header className="topbar"><div className="topbar-inner">
      <Link to="/" className="brand"><Mark/><span>{t('app')}</span></Link>
      <nav className="tabs" aria-label={t('app')}>{nav.map((item) => <Link key={item.to} to={item.to} aria-current={location.pathname === item.to ? 'page' : undefined}>{t(item.label)}</Link>)}</nav>
      <div className="account"><LanguagePicker user={user}/>
        <Button variant="ghost" disabled={offline} onClick={() => void logout()}>{t('logout')}</Button></div>
    </div></header>
    <main className="canvas"><ErrorNotice error={logoutError}/><header className="page-header"><h1>{t(title)}</h1><RealtimeStatus/></header>
      {!allowed ? <p>{t('notAllowed')}</p> : location.pathname === '/users' ? <People current={user}/>
      : location.pathname === '/profile' ? <Profile user={user}/>
      : location.pathname === '/' ? <Ordering key={user.id} user={user}/>
      : location.pathname === '/orders' ? <MyOrders key={user.id} user={user}/>
      : location.pathname === '/menu' ? <MenuManagement key={user.id} user={user}/>
      : location.pathname === '/work' ? <Work key={user.id} user={user}/>
      : <section className="panel"><h2>{t(location.pathname === '/' ? 'welcome' : title)}</h2><p className="muted">{t(location.pathname === '/' ? 'homeHelp' : 'noOrders')}</p></section>}
    </main>
  </div></Realtime>;
}
function LocalAccess({ open }: { open: boolean }) {
  const { t } = useTranslation();
  return <details className="trust-note" open={open}><summary>{t('setupTrust')}</summary><p>{t('setupTrustHelp')}</p>
    <ol><li>{t('setupCertificate')}</li><li>
      <details><summary>{t('setupDesktop')}</summary><p>{t('setupDesktopHelp')}</p></details>
      <details><summary>{t('setupAndroid')}</summary><p>{t('setupAndroidHelp')}</p></details>
      <details><summary>{t('setupIos')}</summary><p>{t('setupIosHelp')}</p></details>
    </li><li>{t('setupVerify')}</li></ol>
    <p>{t('setupLanOnly')}</p>
  </details>;
}
function Auth({ setupRequired }: { setupRequired: boolean }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [done, setDone] = useState(false);
  return <div className="auth-card"><h1 className="auth-welcome">{t('welcome')}</h1>
    <section className="panel"><Form title={t(setupRequired ? 'setup' : 'login')} description={setupRequired ? t('setupHelp') : undefined} submit={t(setupRequired ? 'setup' : 'login')} onSubmit={async (data) => {
      if (setupRequired) {
        await api('/setup', userResponse, 'POST', { name: text(data,'name'), username: text(data,'username'), password: text(data,'password'), setupToken: text(data,'setupToken'), language: i18n.language, floor: '', desk: '' });
        setDone(true); await client.invalidateQueries({ queryKey: ['setup'] });
      } else {
        const result = await api('/auth/login', userResponse, 'POST', { username: text(data,'username'), password: text(data,'password') });
        applyLanguage(result.user.language); client.setQueryData(['session'], result);
      }
    }}>
      {done && <p role="status">{t('setupDone')}</p>}
      {setupRequired && <><Field label={t('setupToken')} name="setupToken" type="password" autoComplete="off" required minLength={32} maxLength={256}/><Field label={t('name')} name="name" autoComplete="name" required maxLength={100}/></>}
      <Field label={t('username')} name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]+"/>
      <p className="hint">{t('usernameHelp')}</p>
      <Password label={t('password')} name="password" current={!setupRequired}/>
      {setupRequired && <p className="hint">{t('passwordHelp')}</p>}
    </Form>{!setupRequired && <p className="hint">{t('forgot')}</p>}</section><LocalAccess open={setupRequired}/></div>;
}
function PasswordForm({ required = false }: { required?: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  return <section className="panel"><Form title={t(required ? 'changeRequired' : 'changePassword')} description={required ? t('changeRequiredHelp') : t('passwordHelp')} submit={t('changePassword')} onSubmit={async (data) => {
    const result = await api('/auth/change-password', userResponse, 'POST', { currentPassword: text(data,'currentPassword'), newPassword: text(data,'newPassword') });
    client.setQueryData(['session'], result);
  }}><Password label={t('currentPassword')} name="currentPassword" current/><Password label={t('newPassword')} name="newPassword"/></Form></section>;
}
function Profile({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  return <div className="settings"><section className="panel"><Form title={t('account')} submit={t('save')} onSubmit={async (data) => {
    const result = await api('/me', userResponse, 'PATCH', { name: text(data,'name') }); client.setQueryData(['session'], result);
  }}><Field label={t('name')} name="name" defaultValue={user.name} required maxLength={100}/></Form></section><PasswordForm/><PwaSetup user={user}/></div>;
}
