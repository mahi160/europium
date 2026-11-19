import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ordersResponseSchema, orderStatuses, type PublicUser } from '@office-service/shared';
import { api } from '../api';
import { ErrorNotice } from '../components/forms';
import { Button } from '../components/ui/button';
import { OrderCard } from '../components/order-card';
import { number } from '../i18n';
import { OrderFocus } from '../components/order-focus';

export function Work({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const statusId = useId();
  const assigneeId = useId();
  const [view, setView] = useState('PENDING');
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const result = useQuery({ queryKey: ['work-orders', user.id, user.role], queryFn: () => api('/work/orders', ordersResponseSchema) });
  const all = result.data?.orders ?? [];
  const people = new Map(all.flatMap((order) => order.assignee ? [[order.assignee.id, order.assignee.name] as const] : []));
  const visible = all.filter((order) => (view === 'all' || order.status === view || (view === 'completed' && ['DELIVERED', 'REJECTED', 'CANCELLED'].includes(order.status)))
    && (!assignee || (assignee === 'unassigned' ? order.assignee === null : order.assignee?.id === assignee)));
  return <section aria-labelledby="queue-heading"><OrderFocus user={user} work/>
    <div className="section-heading"><h2 id="queue-heading" className="section-title">{t(user.role === 'admin' ? 'allOfficeOrders' : 'workQueue')}</h2><Button variant="ghost" className="link-button" onClick={() => void result.refetch()}>{t('refreshOrders')}</Button></div>
    <div className="work-filters">
      {user.role === 'admin' ? <>
        <div className="field"><label htmlFor={statusId}>{t('status')}</label><select id={statusId} value={view} onChange={(e) => setView(e.target.value)}><option value="all">{t('allStatuses')}</option>{orderStatuses.map((status) => <option value={status} key={status}>{t('statuses.' + status)}</option>)}</select></div>
        <div className="field"><label htmlFor={assigneeId}>{t('assignee')}</label><select id={assigneeId} value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">{t('allAssignees')}</option><option value="unassigned">{t('unassigned')}</option>{[...people].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
      </> : <div className="segmented" role="group" aria-label={t('queueViews')}>{[['PENDING', 'pendingQueue'], ['ACCEPTED', 'myActiveWork'], ['completed', 'myCompletedWork']].map(([value, label]) => <Button key={value} variant="ghost" aria-pressed={view === value} onClick={() => setView(value)}>{t(label)}</Button>)}</div>}
    </div>
    <ErrorNotice error={error ?? result.error} retry={() => { setError(null); void result.refetch(); }}/>
    {result.isPending && <p role="status" className="muted">{t('loading')}</p>}
    {result.data && <p className="muted queue-count" role="status">{t('queueCount', { countText: number(visible.length) })}</p>}
    {result.data && visible.length === 0 && <p className="empty">{t('emptyQueue')}</p>}
    <div className="order-list">{visible.map((order) => <OrderCard key={order.id + ':' + order.updatedAt + ':' + order.audit.length} order={order} user={user} onError={setError} work/>)}</div>
  </section>;
}
