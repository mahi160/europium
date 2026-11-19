import type { Order, OrderAction, PublicUser } from '@office-service/shared';
import { orderResponseSchema } from '@office-service/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { date, number } from '../i18n';
import { Field, Form, text } from './forms';

export function OrderCard({ order, user, work = false, onError }: { order: Order; user: PublicUser; work?: boolean; onError: (error: Error | null) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  async function transition(action: Exclude<OrderAction, 'create'>, reason?: string) {
    onError(null);
    try {
      await api('/orders/' + order.id + '/' + action, orderResponseSchema, 'POST', reason === undefined ? {} : { reason });
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
  const assigned = order.assignee?.id === user.id || user.role === 'admin';
  const reasonForm = (action: 'reject' | 'cancel' | 'requeue', label: string) => <details className="order-more"><summary>{label}</summary>
    <Form compact title={label} submit={label} variant={action === 'requeue' ? 'secondary' : 'destructive'} onSubmit={(data) => transition(action, text(data, 'reason'))}><Field label={t('requiredReason')} name="reason" required maxLength={500}/></Form></details>;
  return <article className={'order-card status-' + order.status.toLowerCase()} aria-label={t('orderAt', { time: date(order.createdAt) })}>
    <header className="order-head"><h3>{t('statuses.' + order.status)}</h3><time className="muted">{date(order.createdAt)}</time></header>
    <ul className="order-items">{order.items.map((item) => <li key={item.itemId}>{item.name}<span className="muted">{number(item.quantity)} {item.unit}</span></li>)}</ul>
    {work && (order.floor || order.desk) && <p className="order-place">{[order.floor && t('floor') + ' ' + order.floor, order.desk && t('desk') + ' ' + order.desk].filter(Boolean).join(', ')}</p>}
    {order.note && <p className="order-note">{order.note}</p>}
    {order.reason && <p className="notice">{t('reason')}: {order.reason}</p>}
    <p className="order-meta muted">
      {order.status === 'PENDING' && <span className="waiting">{t('waitingMinutes', { minutes: number(Math.max(0, Math.floor((Date.now() - order.createdAt) / 60000))) })}</span>}
      {(work || order.assignee) && <span>{t('assignee')}: {order.assignee?.name ?? t('unassigned')}</span>}
    </p>
    {work && order.status === 'PENDING' && <div className="order-actions">
      <Form compact title={t('acceptOrder')} submit={t('acceptOrder')} onSubmit={() => transition('accept')}><></></Form>
      {reasonForm('reject', t('rejectOrder'))}
    </div>}
    {work && order.status === 'ACCEPTED' && assigned && <div className="order-actions">
      <Form compact title={t('deliverOrder')} submit={t('deliverOrder')} onSubmit={() => transition('deliver')}><></></Form>
      {reasonForm('cancel', t('cancelOrder'))}
      {user.role === 'admin' && reasonForm('requeue', t('requeueOrder'))}
    </div>}
    {!work && order.status === 'PENDING' && <div className="order-actions"><Form compact title={t('cancelOrder')} submit={t('cancelOrder')} variant="secondary" onSubmit={(data) => transition('cancel', text(data, 'reason'))}><Field label={t('cancelReason')} name="reason" maxLength={500}/></Form></div>}
    <details className="order-history"><summary>{t('orderHistory')}</summary><ol>{order.audit.map((entry) => <li key={entry.id}>
      <strong>{t('orderActions.' + entry.action)}</strong> <span className="muted">{entry.actor.name}, {date(entry.at)}</span>
      {entry.reason && <p>{t('reason')}: {entry.reason}</p>}
    </li>)}</ol></details>
  </article>;
}
