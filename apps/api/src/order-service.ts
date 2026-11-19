import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Order, OrderAction } from '@office-service/shared';
import { AppError, type Actor, type CommandSecurity } from './app';
import type { openDatabase } from './database';
import { orderHistory, orderItem, orders, user } from './schema';
import type { PublishChange } from './events';

type StoredOrder = typeof orders.$inferSelect;
type CurrentUser = typeof user.$inferSelect;

export function workScope(db: ReturnType<typeof openDatabase>['db'], actor: CurrentUser) {
  if (actor.role === 'employee') throw new AppError('FORBIDDEN', 403);
  if (actor.role === 'admin') return undefined;
  const history = db.select({ orderId: orderHistory.orderId }).from(orderHistory)
    .where(or(eq(orderHistory.assigneeId, actor.id), and(eq(orderHistory.actorId, actor.id), eq(orderHistory.action, 'reject'))));
  return or(eq(orders.status, 'PENDING'), eq(orders.assigneeId, actor.id), and(
    inArray(orders.status, ['DELIVERED', 'REJECTED', 'CANCELLED']), inArray(orders.id, history),
  ));
}

export function createOrderService({ db, sqlite }: ReturnType<typeof openDatabase>, { freshActor }: CommandSecurity, publish: PublishChange) {
  function person(id: string | null) {
    if (id === null) return null;
    const value = db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, id)).get();
    if (!value) throw new Error('Order assignee missing');
    return value;
  }
  function view(value: StoredOrder): Order {
    return {
      id: value.id, userId: value.userId, status: value.status,
      floor: value.floor, desk: value.desk, note: value.note, reason: value.reason,
      createdAt: value.createdAt, updatedAt: value.updatedAt,
      assignee: person(value.assigneeId), acceptedAt: value.acceptedAt, completedAt: value.completedAt,
      items: db.select({ itemId: orderItem.itemId, name: orderItem.name, unit: orderItem.unit, quantity: orderItem.quantity })
        .from(orderItem).where(eq(orderItem.orderId, value.id)).all(),
      audit: db.select().from(orderHistory).where(eq(orderHistory.orderId, value.id)).orderBy(asc(orderHistory.id)).all().map((entry) => ({
        id: entry.id, action: entry.action, actor: { id: entry.actorId, name: entry.actorName }, at: entry.at,
        fromStatus: entry.fromStatus, toStatus: entry.toStatus, fromAssigneeId: entry.fromAssigneeId,
        assignee: entry.assigneeId === null ? null : { id: entry.assigneeId, name: entry.assigneeName }, reason: entry.reason,
      })),
    };
  }
  function record(value: StoredOrder, actor: CurrentUser, action: OrderAction, before: StoredOrder | null) {
    const assignee = person(value.assigneeId);
    db.insert(orderHistory).values({
      orderId: value.id, action, actorId: actor.id, actorName: actor.name, at: value.updatedAt,
      fromStatus: before?.status ?? null, toStatus: value.status, fromAssigneeId: before?.assigneeId ?? null,
      assigneeId: value.assigneeId, assigneeName: assignee?.name ?? '', reason: value.reason,
    }).run();
  }
  function detail(id: string, actor: CurrentUser) {
    const scope = actor.role === 'employee' ? eq(orders.userId, actor.id)
      : actor.role === 'admin' ? undefined : or(eq(orders.userId, actor.id), workScope(db, actor));
    const value = db.select().from(orders).where(and(eq(orders.id, id), scope)).get();
    if (!value) throw new AppError('NOT_FOUND', 404);
    return view(value);
  }
  function transition(id: string, actor: Actor, action: Exclude<OrderAction, 'create'>, reason: string | null): Order {
    const result = sqlite.transaction(() => {
      const current = freshActor(actor);
      const value = db.select().from(orders).where(eq(orders.id, id)).get();
      if (!value) throw new AppError('NOT_FOUND', 404);
      const privileged = current.role === 'staff' || current.role === 'admin';
      const assigned = privileged && (value.assigneeId === current.id || current.role === 'admin');
      if (action === 'cancel') {
        if (value.status === 'PENDING' && value.userId !== current.id) {
          const previousAssignment = privileged && db.select({ id: orderHistory.id }).from(orderHistory)
            .where(and(eq(orderHistory.orderId, id), eq(orderHistory.assigneeId, current.id))).get();
          if (previousAssignment) throw new AppError('ORDER_CONFLICT', 409);
          throw new AppError('NOT_FOUND', 404);
        }
        if (value.status !== 'PENDING' && !assigned && value.userId !== current.id) throw new AppError('FORBIDDEN', 403);
        if (value.status === 'ACCEPTED' && !assigned) throw new AppError('ORDER_NOT_PENDING', 409);
      } else {
        if (!privileged || (action === 'requeue' && current.role !== 'admin')) throw new AppError('FORBIDDEN', 403);
        if (action === 'deliver' && value.status === 'ACCEPTED' && !assigned) throw new AppError('FORBIDDEN', 403);
      }
      const expected = action === 'accept' || action === 'reject' ? 'PENDING'
        : action === 'cancel' && value.status === 'PENDING' ? 'PENDING' : 'ACCEPTED';
      if (value.status !== expected) throw new AppError(action === 'cancel' && value.userId === current.id ? 'ORDER_NOT_PENDING' : 'ORDER_CONFLICT', 409);
      if ((action === 'reject' || action === 'requeue' || (action === 'cancel' && expected === 'ACCEPTED')) && !reason) throw new AppError('VALIDATION_ERROR');
      const status = action === 'accept' ? 'ACCEPTED' : action === 'deliver' ? 'DELIVERED'
        : action === 'reject' ? 'REJECTED' : action === 'cancel' ? 'CANCELLED' : 'PENDING';
      const now = Date.now();
      const updated = db.update(orders).set({
        status, reason: reason || null, updatedAt: now,
        assigneeId: action === 'accept' ? current.id : action === 'requeue' ? null : value.assigneeId,
        acceptedAt: action === 'accept' ? now : action === 'requeue' ? null : value.acceptedAt,
        completedAt: status === 'DELIVERED' || status === 'REJECTED' || status === 'CANCELLED' ? now : null,
      }).where(and(eq(orders.id, id), eq(orders.status, expected), value.assigneeId === null
        ? isNull(orders.assigneeId) : eq(orders.assigneeId, value.assigneeId))).returning().get();
      if (!updated) throw new AppError('ORDER_CONFLICT', 409);
      record(updated, current, action, value);
      return { order: view(updated), wasPending: value.status === 'PENDING' };
    }).immediate();
    publish({ kind: 'order', id, wasPending: result.wasPending });
    return result.order;
  }
  return { view, record, workScope: (actor: CurrentUser) => workScope(db, actor), detail, transition };
}
