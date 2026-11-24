import type {
  Order,
  OrderResponse,
  OrdersResponse,
  PersonalOrdersResponse,
  PublicUser,
} from '@office-service/shared';
import type { QueryClient } from '@tanstack/react-query';

export function refreshOrders(client: QueryClient, userId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['orders', userId] }),
    client.invalidateQueries({ queryKey: ['work-orders', userId] }),
  ]);
}

export async function cacheOrder(client: QueryClient, user: PublicUser, order: Order) {
  const personal = ['orders', user.id];
  const work = ['work-orders', user.id, user.role];
  const focus = [
    user.role === 'staff' ? 'work-orders' : 'orders',
    user.id,
    'focus',
    user.role,
    order.id,
  ];
  // Ignore refetches that started before this response was applied.
  await Promise.all(
    [personal, work, focus].map((queryKey) => client.cancelQueries({ queryKey, exact: true })),
  );
  const revision = ['order-revision', user.id, order.id];
  const knownRevision = client.getQueryData<number>(revision) ?? 0;
  if (knownRevision > order.audit.length) return;
  client.setQueryData(revision, order.audit.length);
  const merge = (current: OrdersResponse | undefined, include: boolean, direction: number) => {
    if (!current && !include) return undefined;
    const existing = current?.orders.find((value) => value.id === order.id);
    if (existing && existing.audit.length > order.audit.length) return current;
    const orders = current?.orders.filter((value) => value.id !== order.id) ?? [];
    if (include) orders.push(order);
    orders.sort((a, b) => direction * (a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
    return { orders };
  };
  if (order.userId === user.id)
    client.setQueryData<PersonalOrdersResponse>(personal, (current) => {
      const merged = merge(current, true, -1);
      if (!merged) return current;
      const last = current?.lastOrder;
      const newer =
        !last ||
        (last.id === order.id
          ? order.audit.length >= last.audit.length
          : order.createdAt > last.createdAt ||
            (order.createdAt === last.createdAt && order.id > last.id));
      return { ...merged, lastOrder: newer ? order : last };
    });
  if (user.role !== 'employee')
    client.setQueryData<OrdersResponse>(work, (current) =>
      merge(
        current,
        order.status === 'PENDING' ||
          (order.status === 'ACCEPTED' &&
            (user.role === 'admin' || order.assignee?.id === user.id)),
        1,
      ),
    );
  client.setQueryData<OrderResponse>(
    focus,
    (current) => current && (current.order.audit.length > order.audit.length ? current : { order }),
  );
}
