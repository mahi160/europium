import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { Button } from './ui/button';
import { useOffline } from '../realtime';

export function Field({ label, ...props }: ComponentProps<'input'> & { label: string }) {
  const id = useId();
  const { t } = useTranslation();
  return <div className="field"><label htmlFor={id}>{label}{props.required ? ' *' : ''}</label><input id={id} {...props}
    onInvalid={(e) => e.currentTarget.setCustomValidity(t('validation'))}
    onInput={(e) => e.currentTarget.setCustomValidity('')} /></div>;
}
export function Password({ label, name, current = false }: { label: string; name: string; current?: boolean }) {
  const [shown, setShown] = useState(false);
  const { t } = useTranslation();
  return <div className="password"><Field label={label} name={name} type={shown ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'} required minLength={current ? 1 : 12} maxLength={128} />
    <Button variant="ghost" aria-pressed={shown} onClick={() => setShown(!shown)}>{t(shown ? 'hidePassword' : 'showPassword')}</Button></div>;
}
export function ErrorNotice({ error, retry }: { error: Error | null; retry?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  const key = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  return <div className="notice error" role="alert">{t('errors.' + key, { defaultValue: t('errors.INTERNAL_ERROR') })}{retry && <Button variant="ghost" onClick={retry}>{t('retry')}</Button>}</div>;
}
export function Form({ title, children, submit, onSubmit, description, disabled = false, compact = false, showSaved = true, variant }: { title: string; children: ReactNode; submit: string; description?: string; disabled?: boolean; compact?: boolean; showSaved?: boolean; variant?: 'secondary' | 'destructive'; onSubmit: (data: FormData) => Promise<void> }) {
  const id = useId();
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const offline = useOffline();
  const { t } = useTranslation();
  return <form method="post" action="#" aria-labelledby={id} className={compact ? 'form-compact' : undefined} onSubmit={async (e) => {
    e.preventDefault(); if (busy || disabled || offline || !navigator.onLine) return;
    const data = new FormData(e.currentTarget);
    setBusy(true); setError(null); setSaved(false);
    try { await onSubmit(data); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error()); }
    finally { setBusy(false); }
  }}>
    <h2 id={id} className={compact ? 'sr-only' : undefined}>{title}</h2>{description && <p className="muted">{description}</p>}
    {children}<ErrorNotice error={error} />
    <div className="form-actions"><Button type="submit" variant={variant} disabled={busy || disabled || offline}>{busy ? t('saving') : submit}</Button>
    {saved && showSaved && <span role="status">{t('saved')}</span>}</div>
  </form>;
}
export function text(data: FormData, key: string) { return String(data.get(key) ?? ''); }
