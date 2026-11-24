import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ordersResponseSchema, type PublicUser } from '@office-service/shared';
import { api } from '../api';
import { ErrorNotice } from '../components/forms';
import { OrderCard } from '../components/order-card';

export function Work({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const [error, setError] = useState<Error | null>(null);
  const [feedback, setFeedback] = useState('');
  const result = useQuery({ queryKey: ['work-orders', user.id, user.role], queryFn: () => api('/work/orders', ordersResponseSchema) });
  const orders = (result.data?.orders ?? []).filter((order) => order.status === 'PENDING' || order.status === 'ACCEPTED');
  const title = t(user.role === 'admin' ? 'activeOrders' : 'workQueue');
  return <section className="work-queue grid max-w-2xl gap-4" aria-label={title}>
    {user.role === 'admin' && <h2>{title}</h2>}
    <ErrorNotice error={error ?? result.error} retry={() => { setError(null); void result.refetch(); }}/>
    <p role="status">{feedback && t(feedback)}</p>
    {result.isPending && <p role="status">{t('loading')}</p>}
    {result.data && orders.length === 0 && <p>{t('emptyQueue')}</p>}
    {orders.map((order) => <OrderCard key={order.id} order={order} user={user} onError={setError} work onTransition={(action) => setFeedback(action === 'accept' ? 'acceptedFeedback' : 'deliveredFeedback')}/>)}
  </section>;
}
