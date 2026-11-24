import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  cancelOrderSchema,
  createOrderSchema,
  emptyCommandSchema,
  menuInputSchema,
  requeueOrderSchema,
  transitionReasonSchema,
} from '@office-service/shared';
import { AppError, input, type AppEnv, type CommandSecurity } from './app';
import type { openDatabase } from './database';
import { menuItem, orderItem, orders } from './schema';
import { createOrderService } from './order-service';
import type { PublishChange } from './events';

export function registerOrders(
  app: Hono<AppEnv>,
  { db, sqlite }: ReturnType<typeof openDatabase>,
  { actorFor, freshActor }: CommandSecurity,
  publish: PublishChange,
) {
  const service = createOrderService({ db, sqlite }, { actorFor, freshActor }, publish);
  const orderView = service.view;
  function identifier(value: unknown) {
    const parsed = z.uuid().safeParse(value);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR');
    return parsed.data;
  }

  app.get('/api/menu', async (c) => {
    const actor = await actorFor(c);
    const current = freshActor(actor);
    const items =
      current.role === 'admin'
        ? db.select().from(menuItem).all()
        : db.select().from(menuItem).where(eq(menuItem.archived, false)).all();
    return c.json({ items });
  });
  app.post('/api/menu', async (c) => {
    const actor = await actorFor(c, true);
    const data = input(c, menuInputSchema);
    const item = sqlite
      .transaction(() => {
        freshActor(actor, true);
        return db
          .insert(menuItem)
          .values({ id: randomUUID(), ...data })
          .returning()
          .get();
      })
      .immediate();
    publish({ kind: 'menu' });
    return c.json({ item }, 201);
  });
  app.patch('/api/menu/:id', async (c) => {
    const actor = await actorFor(c, true);
    const id = identifier(c.req.param('id'));
    const data = input(c, menuInputSchema);
    let changed = false;
    const item = sqlite
      .transaction(() => {
        freshActor(actor, true);
        const previous = db.select().from(menuItem).where(eq(menuItem.id, id)).get();
        if (!previous) throw new AppError('NOT_FOUND', 404);
        changed =
          previous.name !== data.name ||
          previous.category !== data.category ||
          previous.unit !== data.unit ||
          previous.available !== data.available ||
          previous.archived !== data.archived;
        if (!changed) return previous;
        const result = db.update(menuItem).set(data).where(eq(menuItem.id, id)).returning().get();
        if (!result) throw new AppError('NOT_FOUND', 404);
        return result;
      })
      .immediate();
    if (changed) publish({ kind: 'menu' });
    return c.json({ item });
  });
  app.post('/api/orders', async (c) => {
    const actor = await actorFor(c);
    const data = input(c, createOrderSchema);
    const items = [...data.items].sort((a, b) => a.itemId.localeCompare(b.itemId));
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ items, note: data.note }))
      .digest('hex');
    const result = sqlite
      .transaction(() => {
        const current = freshActor(actor);
        const previous = db
          .select()
          .from(orders)
          .where(
            and(eq(orders.userId, actor.userId), eq(orders.idempotencyKey, data.idempotencyKey)),
          )
          .get();
        if (previous) {
          if (previous.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_MISMATCH', 409);
          return { order: orderView(previous), created: false };
        }
        const selected = items.map((entry) => {
          const item = db.select().from(menuItem).where(eq(menuItem.id, entry.itemId)).get();
          if (!item || !item.available || item.archived)
            throw new AppError('ITEM_UNAVAILABLE', 409);
          return { item, quantity: entry.quantity };
        });
        const now = Date.now();
        const value = db
          .insert(orders)
          .values({
            id: randomUUID(),
            userId: actor.userId,
            idempotencyKey: data.idempotencyKey,
            requestHash,
            status: 'PENDING',
            floor: current.floor,
            desk: current.desk,
            note: data.note,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        for (const { item, quantity } of selected) {
          db.insert(orderItem)
            .values({
              id: randomUUID(),
              orderId: value.id,
              itemId: item.id,
              name: item.name,
              unit: item.unit,
              quantity,
            })
            .run();
        }
        service.record(value, current, 'create', null);
        return { order: orderView(value), created: true };
      })
      .immediate();
    if (result.created) publish({ kind: 'order', id: result.order.id, wasPending: false });
    return c.json({ order: result.order }, result.created ? 201 : 200);
  });
  app.get('/api/orders', async (c) => {
    const actor = await actorFor(c);
    freshActor(actor);
    const dhakaOffset = 6 * 60 * 60 * 1000;
    const today = Math.floor((Date.now() + dhakaOffset) / 86400000) * 86400000 - dhakaOffset;
    const values = db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.userId, actor.userId),
          or(inArray(orders.status, ['PENDING', 'ACCEPTED']), gte(orders.updatedAt, today)),
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .all();
    const visible = values.map(orderView);
    const last = db
      .select()
      .from(orders)
      .where(eq(orders.userId, actor.userId))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .get();
    return c.json({
      orders: visible,
      lastOrder: last ? (visible.find((order) => order.id === last.id) ?? orderView(last)) : null,
    });
  });
  app.get('/api/orders/:id', async (c) => {
    const actor = await actorFor(c);
    const current = freshActor(actor);
    return c.json({ order: service.detail(identifier(c.req.param('id')), current) });
  });
  app.post('/api/orders/:id/cancel', async (c) => {
    const actor = await actorFor(c);
    const id = identifier(c.req.param('id'));
    const data = input(c, cancelOrderSchema);
    const order = service.transition(id, actor, 'cancel', data.reason);
    return c.json({ order });
  });
  app.get('/api/work/orders', async (c) => {
    const actor = await actorFor(c);
    const current = freshActor(actor);
    const values = db
      .select()
      .from(orders)
      .where(service.workScope(current))
      .orderBy(asc(orders.createdAt), asc(orders.id))
      .all();
    return c.json({ orders: values.map(orderView) });
  });
  app.get('/api/work/acceptances', async (c) => {
    const actor = await actorFor(c);
    const current = freshActor(actor);
    if (current.role !== 'staff') return c.json({ acceptances: [] });
    // Recent claims by other staff on requests that are still accepted, newest first.
    const acceptances = sqlite
      .prepare<[string, string, number], { id: number; requestedBy: string; acceptedBy: string }>(`
      SELECT h.id, u.name AS requestedBy, h.actor_name AS acceptedBy
      FROM order_history h JOIN orders o ON o.id = h.order_id JOIN user u ON u.id = o.user_id
      WHERE h.action = 'accept' AND h.actor_id != ? AND o.user_id != ? AND h.at >= ? AND o.status = 'ACCEPTED'
        AND h.id = (SELECT max(id) FROM order_history WHERE order_id = o.id)
      ORDER BY h.id DESC LIMIT 5
    `)
      .all(current.id, current.id, Date.now() - 10 * 60 * 1000);
    return c.json({ acceptances });
  });
  for (const action of ['accept', 'deliver', 'reject', 'requeue'] as const) {
    app.post('/api/orders/:id/' + action, async (c) => {
      const actor = await actorFor(c);
      const id = identifier(c.req.param('id'));
      let reason: string | null = null;
      if (action === 'reject') reason = input(c, transitionReasonSchema).reason;
      else if (action === 'requeue') reason = input(c, requeueOrderSchema).reason ?? null;
      else input(c, emptyCommandSchema);
      const order = service.transition(id, actor, action, reason);
      return c.json({ order });
    });
  }
}
