import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@office-service/shared';
import { api, sessionResponse, setupResponse, successResponse, userResponse } from '../api';
import { applyLanguage } from '../i18n';
import { Button, buttonVariants } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { FieldDescription, FieldLabel } from '../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { IconCoffee } from '@tabler/icons-react';
import { ErrorNotice, Field, Form, Password, text } from '../components/forms';
import { OrderFocus } from '../components/order-focus';
import { PwaSetup } from '../components/pwa';
import { People } from './people';
import { MenuManagement, Ordering } from './ordering';
import { clearDraft } from '../draft';
import { Work } from './work';
import { Realtime, RealtimeStatus, useOffline } from '../realtime';

export function LanguagePicker({ user }: { user?: PublicUser }) {
  const { t, i18n } = useTranslation();
  const offline = useOffline();
  const client = useQueryClient();
  const [error, setError] = useState<Error | null>(null);
  const id = useId();
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor={id} className="sr-only">
        {t('language')}
      </FieldLabel>
      <NativeSelect
        id={id}
        disabled={!!user && offline}
        value={i18n.language}
        onChange={async (e) => {
          const language = e.target.value;
          setError(null);
          try {
            if (user) {
              const result = await api('/me', userResponse, 'PATCH', { language });
              client.setQueryData(['session'], result);
            }
            applyLanguage(language);
          } catch (cause) {
            setError(cause instanceof Error ? cause : new Error());
          }
        }}
      >
        <NativeSelectOption value="bn">বাংলা</NativeSelectOption>
        <NativeSelectOption value="en">English</NativeSelectOption>
      </NativeSelect>
      <ErrorNotice error={error} />
    </div>
  );
}
export function Application() {
  const { t } = useTranslation();
  const offline = useOffline();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api('/setup', setupResponse) });
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api('/auth/get-session', sessionResponse),
  });
  const user = session.data?.user;
  const [logoutError, setLogoutError] = useState<Error | null>(null);
  const path = location.pathname;
  useEffect(() => {
    document.title =
      t(!user ? 'login' : path === '/admin' ? 'admin' : user.role === 'staff' ? 'work' : 'home') +
      ' · ' +
      t('app');
  }, [path, user?.id, t]);
  async function logout() {
    setLogoutError(null);
    try {
      await api('/auth/logout', successResponse, 'POST', {});
      if (user) clearDraft(user.id);
      await client.cancelQueries();
      client.removeQueries({
        predicate: (query) => !['session', 'setup'].includes(String(query.queryKey[0])),
      });
      client.setQueryData(['session'], { user: null });
      await navigate({ to: '/' });
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause : new Error());
    }
  }
  useEffect(() => {
    if (user) applyLanguage(user.language);
  }, [user?.id, user?.language]);
  if (setup.isPending || session.isPending)
    return (
      <main className="mx-auto max-w-md p-6">
        <p role="status">{t('loading')}</p>
      </main>
    );
  if ((setup.error && !setup.data) || (session.error && !session.data))
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorNotice
          error={setup.error ?? session.error}
          retry={() => {
            void setup.refetch();
            void session.refetch();
          }}
        />
      </main>
    );
  if (!user)
    return (
      <main className="mx-auto grid w-full max-w-md gap-8 px-4 py-8 sm:py-16">
        <header className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <IconCoffee aria-hidden="true" />
            {t('app')}
          </span>
          <LanguagePicker />
        </header>
        <Auth setupRequired={setup.data?.setupRequired ?? false} />
      </main>
    );
  if (user.mustChangePassword)
    return (
      <main className="mx-auto grid w-full max-w-md gap-8 px-4 py-8">
        <header className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <IconCoffee aria-hidden="true" />
            {t('app')}
          </span>
          <Button variant="ghost" disabled={offline} onClick={() => void logout()}>
            {t('logout')}
          </Button>
        </header>
        <PasswordForm user={user} required />
        <ErrorNotice error={logoutError} />
      </main>
    );
  const adminPage = path === '/admin';
  const orderingPage = !adminPage && user.role !== 'staff';
  return (
    <Realtime key={user.id + ':' + user.role + ':' + user.language} user={user}>
      <div className="app-shell mx-auto min-h-dvh w-full px-4 sm:px-6">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50">
          {t('skipContent')}
        </a>
        <header className="app-header flex flex-wrap items-center justify-between gap-3 py-4">
          <span className="flex items-center gap-2 font-medium">
            <IconCoffee aria-hidden="true" />
            {t('app')}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {user.role === 'admin' && (
              <nav className="flex gap-2" aria-label={t('navigation')}>
                <Link
                  to="/"
                  className={buttonVariants({ variant: adminPage ? 'ghost' : 'secondary' })}
                  aria-current={!adminPage ? 'page' : undefined}
                >
                  {t('home')}
                </Link>
                <Link
                  to="/admin"
                  className={buttonVariants({ variant: adminPage ? 'secondary' : 'ghost' })}
                  aria-current={adminPage ? 'page' : undefined}
                >
                  {t('admin')}
                </Link>
              </nav>
            )}
            <LanguagePicker user={user} />
            <AccountMenu key={user.id} user={user} />
            <Button variant="ghost" disabled={offline} onClick={() => void logout()}>
              {t('logout')}
            </Button>
          </div>
        </header>
        <main className="grid content-start gap-6 py-6" id="main-content" tabIndex={-1}>
          <ErrorNotice error={logoutError} />
          {!orderingPage && (
            <div className="page-heading flex flex-wrap items-center justify-between gap-3">
              <h1>{t(adminPage ? 'admin' : 'work')}</h1>
              <RealtimeStatus />
            </div>
          )}
          {!adminPage && user.role !== 'admin' && (
            <>
              <PwaSetup user={user} />
              <OrderFocus user={user} work={user.role === 'staff'} />
            </>
          )}
          {adminPage ? (
            user.role === 'admin' ? (
              <div className="grid items-start gap-8 md:grid-cols-2">
                <section className="grid min-w-0 gap-4" aria-label={t('users')}>
                  <h2>{t('users')}</h2>
                  <People current={user} />
                </section>
                <section className="grid min-w-0 gap-4" aria-label={t('menu')}>
                  <h2>{t('menu')}</h2>
                  <MenuManagement user={user} />
                </section>
                <Work user={user} />
              </div>
            ) : (
              <p>{t('notAllowed')}</p>
            )
          ) : user.role === 'staff' ? (
            <Work user={user} />
          ) : (
            <Ordering user={user} />
          )}
        </main>
      </div>
    </Realtime>
  );
}
function AccountMenu({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const offline = useOffline();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const label = t(user.role === 'admin' ? 'changePassword' : 'changePin');
  return (
    <div className="relative">
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" className="account-name" />}>
          <span className="truncate">{user.name}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="absolute end-0 z-20 min-w-max rounded-lg border bg-popover p-2">
          <Dialog
            open={open}
            onOpenChange={(next) => {
              if (next) setSaved(false);
              setOpen(next);
            }}
          >
            <DialogTrigger render={<Button variant="ghost" disabled={offline} />}>
              {label}
            </DialogTrigger>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>{label}</DialogTitle>
              </DialogHeader>
              <PasswordForm
                user={user}
                onSaved={() => {
                  setOpen(false);
                  setSaved(true);
                }}
              />
              <DialogClose render={<Button variant="outline" />}>{t('close')}</DialogClose>
            </DialogContent>
          </Dialog>
        </CollapsibleContent>
      </Collapsible>
      {saved && (
        <span role="status" className="text-sm">
          {t('saved')}
        </span>
      )}
    </div>
  );
}
function LocalAccess({ open }: { open: boolean }) {
  const { t } = useTranslation();
  return (
    <Collapsible defaultOpen={open}>
      <CollapsibleTrigger render={<Button variant="ghost" />}>{t('setupTrust')}</CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 pt-3">
        <FieldDescription>{t('setupTrustHelp')}</FieldDescription>
        <ol className="grid gap-2">
          <li className="grid gap-1">
            {t('setupCertificate')}
            <a href={`http://${window.location.host}/connect`} className="font-mono underline">
              {`http://${window.location.host}/connect`}
            </a>
          </li>
          <li>{t('setupVerify')}</li>
        </ol>
        <FieldDescription>{t('setupLanOnly')}</FieldDescription>
      </CollapsibleContent>
    </Collapsible>
  );
}
function Auth({ setupRequired }: { setupRequired: boolean }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [done, setDone] = useState(false);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <h1>{t(setupRequired ? 'setup' : 'login')}</h1>
          <FieldDescription>{t('authIntro')}</FieldDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Form
            hideTitle
            showSaved={false}
            title={t(setupRequired ? 'setup' : 'login')}
            description={setupRequired ? t('setupHelp') : undefined}
            submit={t(setupRequired ? 'setup' : 'login')}
            onSubmit={async (data) => {
              if (setupRequired) {
                await api('/setup', userResponse, 'POST', {
                  name: text(data, 'name'),
                  username: text(data, 'username'),
                  password: text(data, 'password'),
                  setupToken: text(data, 'setupToken'),
                  language: i18n.language,
                  floor: '',
                  desk: '',
                });
                setDone(true);
                await client.invalidateQueries({ queryKey: ['setup'] });
              } else {
                const result = await api('/auth/login', userResponse, 'POST', {
                  username: text(data, 'username'),
                  password: text(data, 'password'),
                });
                applyLanguage(result.user.language);
                client.setQueryData(['session'], result);
              }
            }}
          >
            {done && <p role="status">{t('setupDone')}</p>}
            {setupRequired && (
              <>
                <Field
                  label={t('setupToken')}
                  name="setupToken"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={32}
                  maxLength={256}
                />
                <Field label={t('name')} name="name" autoComplete="name" required maxLength={100} />
              </>
            )}
            <Field
              label={t('username')}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]+"
            />
            <FieldDescription>{t('usernameHelp')}</FieldDescription>
            <Password
              key={setupRequired ? 'setup' : 'login'}
              login={!setupRequired}
              label={t(setupRequired ? 'password' : 'loginSecret')}
              name="password"
              current={!setupRequired}
            />
            {setupRequired && <FieldDescription>{t('passwordHelp')}</FieldDescription>}
          </Form>
          {!setupRequired && <FieldDescription>{t('forgotLoginSecret')}</FieldDescription>}
        </CardContent>
      </Card>
      <LocalAccess key={String(setupRequired)} open={setupRequired} />
    </div>
  );
}
function PasswordForm({
  user,
  required = false,
  onSaved,
}: {
  user: PublicUser;
  required?: boolean;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const pin = user.role !== 'admin';
  const title = t(
    pin
      ? required
        ? 'changePinRequired'
        : 'changePin'
      : required
        ? 'changeRequired'
        : 'changePassword',
  );
  const form = (
    <Form
      hideTitle
      showSaved={false}
      title={title}
      description={t(
        pin
          ? required
            ? 'changePinRequiredHelp'
            : 'personalPinHelp'
          : required
            ? 'changeRequiredHelp'
            : 'personalPasswordHelp',
      )}
      submit={t(pin ? 'changePin' : 'changePassword')}
      onSubmit={async (data) => {
        const result = await api('/auth/change-password', userResponse, 'POST', {
          currentPassword: text(data, 'currentPassword'),
          newPassword: text(data, 'newPassword'),
        });
        client.setQueryData(['session'], result);
        onSaved?.();
      }}
    >
      <Password
        pin={pin}
        label={t(pin ? 'currentPin' : 'currentPassword')}
        name="currentPassword"
        current
      />
      <Password pin={pin} label={t(pin ? 'newPin' : 'newPassword')} name="newPassword" />
    </Form>
  );
  return required ? (
    <Card>
      <CardContent>
        <h1>{title}</h1>
        {form}
      </CardContent>
    </Card>
  ) : (
    form
  );
}
