import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requeueOrderSchema, transitionReasonSchema } from '@office-service/shared';
import { ApiError } from '../api';
import { useOffline } from '../realtime';
import { Field, Form, text } from './forms';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';

export function OrderReasonDialog({ label, variant = 'destructive', required = true, onSubmit }: { label: string; variant?: 'secondary' | 'destructive'; required?: boolean; onSubmit: (reason: string) => Promise<void> }) {
  const { t } = useTranslation();
  const offline = useOffline();
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button type="button" variant={variant} disabled={offline}/>}>{label}</DialogTrigger>
    <DialogContent showCloseButton={false}>
      <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
      <Form compact showSaved={false} title={label} submit={label} variant={variant} onSubmit={async (data) => {
        const result = (required ? transitionReasonSchema : requeueOrderSchema).safeParse({ reason: text(data, 'reason') });
        if (!result.success) throw new ApiError('VALIDATION_ERROR');
        await onSubmit(result.data.reason ?? '');
        setOpen(false);
      }}><Field label={t(required ? 'requiredReason' : 'optionalReason')} name="reason" required={required} maxLength={500}/></Form>
      <DialogClose render={<Button type="button" variant="outline"/>}>{t('close')}</DialogClose>
    </DialogContent>
  </Dialog>;
}
