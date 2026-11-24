import type { Order, PublicUser } from '@office-service/shared';
import { orderResponseSchema } from '@office-service/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { date, number } from '../i18n';
import { Form } from './forms';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { FieldDescription } from './ui/field';

export function OrderCard({ order, user, work = false, onError, onTransition }: { order: Order; user: PublicUser; work?: boolean; onError: (error: Error | null) => void; onTransition?: (action: 'accept' | 'deliver') => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  async function transition(action: 'accept' | 'deliver' | 'cancel') {
    onError(null);
    try {
      await api('/orders/' + order.id + '/' + action, orderResponseSchema, 'POST', action === 'cancel' ? { reason: '' } : {});
      if (action !== 'cancel') onTransition?.(action);
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error());
      throw cause;
    } finally {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['orders'] }),
        client.invalidateQueries({ queryKey: ['work-orders'] }),
      ]);
    }
  }
  const requester = order.audit.find((entry) => entry.action === 'create')?.actor.name;
  const action = work && order.status === 'PENDING' ? 'accept'
    : work && order.status === 'ACCEPTED' && (order.assignee?.id === user.id || user.role === 'admin') ? 'deliver'
    : !work && user.role === 'employee' && order.userId === user.id && order.status === 'PENDING' ? 'cancel' : null;
  const label = t(action === 'accept' ? 'acceptOrder' : action === 'cancel' ? 'cancelOrder' : 'completedQueue');
  return <article className="order-ticket" data-status={order.status} aria-label={t('orderAt', { time: date(order.createdAt) })}><Card><CardContent className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Badge variant="secondary">{t('statuses.' + order.status)}</Badge>
      <FieldDescription><time dateTime={new Date(order.createdAt).toISOString()}>{date(order.createdAt)}</time></FieldDescription>
    </div>
    {work && requester && <h3>{requester}</h3>}
    {work && (order.floor || order.desk) && <FieldDescription>{[order.floor && t('floor') + ' ' + order.floor, order.desk && t('desk') + ' ' + order.desk].filter(Boolean).join(', ')}</FieldDescription>}
    <ul className="grid gap-1">{order.items.map((item) => <li className="flex justify-between gap-3" key={item.itemId}><span>{item.name}</span><span className="shrink-0">{number(item.quantity)} {item.unit}</span></li>)}</ul>
    {order.note && <p>{order.note}</p>}
    {order.reason && <p>{t('reason')}: {order.reason}</p>}
    {order.assignee && <FieldDescription>{t('assignee')}: {order.assignee.name}</FieldDescription>}
    {action && <Form compact showSaved={false} title={label} submit={label} variant={action === 'cancel' ? 'secondary' : undefined} onSubmit={() => transition(action)}><></></Form>}
  </CardContent></Card></article>;
}
