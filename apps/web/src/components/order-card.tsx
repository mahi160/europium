import type { Order, PublicUser } from '@office-service/shared';
import { orderResponseSchema } from '@office-service/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { date, localDigits, number } from '../i18n';
import { cacheOrder, refreshOrders } from '../order-cache';
import { Form } from './forms';
import { OrderReasonDialog } from './order-reason-dialog';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { FieldDescription } from './ui/field';

export function OrderCard({ order, user, work = false, onError, onTransition }: { order: Order; user: PublicUser; work?: boolean; onError: (error: Error | null) => void; onTransition?: (action: 'accept' | 'deliver') => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  async function transition(action: 'accept' | 'deliver' | 'cancel' | 'reject' | 'requeue', reason = '') {
    onError(null);
    try {
      const result = await api('/orders/' + order.id + '/' + action, orderResponseSchema, 'POST', action === 'accept' || action === 'deliver' ? {} : { reason });
      await cacheOrder(client, user, result.order);
      if (action === 'accept' || action === 'deliver') onTransition?.(action);
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error());
      throw cause;
    } finally {
      void refreshOrders(client, user.id);
    }
  }
  const requester = order.audit.find((entry) => entry.action === 'create')?.actor.name;
  const staffWork = work && user.role === 'staff';
  const canCancel = user.role !== 'admin' && order.userId === user.id && order.status === 'PENDING';
  const action = staffWork && order.status === 'PENDING' ? 'accept'
    : staffWork && order.status === 'ACCEPTED' && order.assignee?.id === user.id ? 'deliver' : null;
  const label = t(action === 'accept' ? 'acceptOrder' : 'deliverOrder');
  const cancelLabel = t('cancelOrder');
  return <article className="order-ticket" data-status={order.status} aria-label={t('orderAt', { time: date(order.createdAt) })}><Card><CardContent className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Badge variant="secondary">{t('statuses.' + order.status)}</Badge>
      <FieldDescription><time dateTime={new Date(order.createdAt).toISOString()}>{date(order.createdAt)}</time></FieldDescription>
    </div>
    {work && requester && <h3>{requester}</h3>}
    {work && (order.floor || order.desk) && <FieldDescription>{[order.floor && t('floor') + ' ' + localDigits(order.floor), order.desk && t('desk') + ' ' + localDigits(order.desk)].filter(Boolean).join(', ')}</FieldDescription>}
    <ul className="grid gap-1">{order.items.map((item) => <li className="flex justify-between gap-3" key={item.itemId}><span>{item.name}</span><span className="shrink-0">{number(item.quantity)} {item.unit}</span></li>)}</ul>
    {order.note && <p>{order.note}</p>}
    {order.reason && <p>{t('reason')}: {order.reason}</p>}
    {order.assignee && <FieldDescription>{t('assignee')}: {order.assignee.name}</FieldDescription>}
    {(action || canCancel) && <div className="flex flex-wrap items-center gap-3">
      {action && <Form compact showSaved={false} title={label} submit={label} onSubmit={() => transition(action)}><></></Form>}
      {canCancel && <Form compact showSaved={false} title={cancelLabel} submit={cancelLabel} variant="secondary" onSubmit={() => transition('cancel')}><></></Form>}
      {action === 'accept' && <OrderReasonDialog label={t('rejectOrder')} onSubmit={(reason) => transition('reject', reason)}/>}
      {action === 'deliver' && <OrderReasonDialog label={t('requeueOrder')} variant="secondary" required={false} onSubmit={(reason) => transition('requeue', reason)}/>}
    </div>}
  </CardContent></Card></article>;
}
