import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field as FieldRoot, FieldDescription, FieldLabel } from './ui/field';
import { Alert, AlertAction, AlertDescription } from './ui/alert';
import { useOffline } from '../realtime';

export function Field({ label, ...props }: ComponentProps<'input'> & { label: string }) {
  const id = useId();
  const { t } = useTranslation();
  return <FieldRoot><FieldLabel htmlFor={id}>{label}{props.required ? ' *' : ''}</FieldLabel><Input id={id} {...props}
    onInvalid={(e) => e.currentTarget.setCustomValidity(t(props.inputMode === 'numeric' ? 'pinValidation' : 'validation'))}
    onInput={(e) => e.currentTarget.setCustomValidity('')} /></FieldRoot>;
}
export function Password({ label, name, current = false, pin = false, defaultValue = '' }: { label: string; name: string; current?: boolean; pin?: boolean; defaultValue?: string }) {
  const [shown, setShown] = useState(false);
  const { t } = useTranslation();
  return <div className="grid gap-2"><Field label={label} name={name} defaultValue={defaultValue} type={shown ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'} required minLength={pin ? 4 : current ? 1 : 12} maxLength={pin ? 4 : 128} inputMode={pin ? 'numeric' : undefined} pattern={pin ? '[0-9]{4}' : undefined} autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
    <Button type="button" variant="ghost" className="justify-self-start" aria-pressed={shown} onClick={() => setShown(!shown)}>{t(pin ? shown ? 'hidePin' : 'showPin' : shown ? 'hidePassword' : 'showPassword')}</Button></div>;
}
export function ErrorNotice({ error, retry }: { error: Error | null; retry?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  const key = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  return <Alert variant="destructive"><AlertDescription>{t('errors.' + key, { defaultValue: t('errors.INTERNAL_ERROR') })}</AlertDescription>{retry && <AlertAction><Button type="button" variant="ghost" onClick={retry}>{t('retry')}</Button></AlertAction>}</Alert>;
}
export function Form({ title, children, submit, onSubmit, description, disabled = false, compact = false, hideTitle = false, showSaved = true, variant, submitClassName }: { title: string; children: ReactNode; submit: string; description?: string; disabled?: boolean; compact?: boolean; hideTitle?: boolean; showSaved?: boolean; submitClassName?: string; variant?: 'secondary' | 'destructive'; onSubmit: (data: FormData) => Promise<void> }) {
  const id = useId();
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  const offline = useOffline();
  const { t } = useTranslation();
  return <form method="post" action="#" aria-labelledby={id} className="grid gap-4" onInput={() => { setError(null); setSaved(false); }} onSubmit={async (e) => {
    e.preventDefault(); if (busy || disabled || offline || !navigator.onLine) return;
    const data = new FormData(e.currentTarget);
    setBusy(true); setError(null); setSaved(false);
    try { await onSubmit(data); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error()); }
    finally { setBusy(false); }
  }}>
    <h2 id={id} className={compact || hideTitle ? 'sr-only' : undefined}>{title}</h2>{description && <FieldDescription>{description}</FieldDescription>}
    {children}{error && <div ref={errorSummary} tabIndex={-1}><ErrorNotice error={error}/></div>}
    <div className={'flex flex-wrap items-center gap-3 ' + (submitClassName ?? '')}><Button type="submit" variant={variant} disabled={busy || disabled || offline}>{busy ? t('saving') : submit}</Button>
    {saved && showSaved && <span role="status">{t('saved')}</span>}</div>
  </form>;
}
export function text(data: FormData, key: string) { return String(data.get(key) ?? ''); }
