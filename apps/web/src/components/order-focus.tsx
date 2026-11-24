import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { orderResponseSchema, safeOrderTarget, type PublicUser } from '@office-service/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ErrorNotice } from './forms';
import { OrderCard } from './order-card';

export function OrderFocus({ user, work = false }: { user: PublicUser; work?: boolean }) {
  const { t } = useTranslation();
  const [error, setError] = useState<Error | null>(null);
  const target = safeOrderTarget(window.location.pathname + window.location.search);
  const id = target ? new URLSearchParams(target.split('?')[1]).get('order') : null;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (id) panel.current?.focus(); }, [id]);
  const result = useQuery({
    queryKey: [work ? 'work-orders' : 'orders', user.id, 'focus', user.role, id],
    queryFn: () => api('/orders/' + id, orderResponseSchema), enabled: !!id,
  });
  if (!id) return null;
  return <section className="mb-6 grid gap-4" aria-label={t('pwaFocusedOrder')} tabIndex={-1} ref={panel}>
    <h2>{t('pwaFocusedOrder')}</h2><ErrorNotice error={error ?? result.error}/>
    {result.isPending && <p role="status">{t('loading')}</p>}
    {result.data && !result.error && <OrderCard key={result.data.order.updatedAt + ':' + result.data.order.audit.length} order={result.data.order} user={user} onError={setError} work={work}/>}
  </section>;
}
