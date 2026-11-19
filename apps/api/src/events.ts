import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { and, eq, or } from 'drizzle-orm';
import type { AppEnv, CommandSecurity } from './app';
import type { openDatabase } from './database';
import { orders } from './schema';
import { workScope } from './order-service';

type Change = { kind: 'menu' } | { kind: 'user'; id: string } | { kind: 'order'; id: string; wasPending: boolean };

export function createEvents(app: Hono<AppEnv>, { db }: ReturnType<typeof openDatabase>, { actorFor, freshActor }: CommandSecurity, heartbeatMs = 15000) {
  const listeners = new Set<(change: Change) => void>();
  const connections = new Set<() => void>();
  let closed = false;

  app.get('/api/events', async (c) => {
    const actor = await actorFor(c);
    const role = freshActor(actor).role;
    if (closed) return c.body(null, 503);
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      c.header('Cache-Control', 'no-store');
      let ended = false;
      let writing = false;
      let dirty = false;
      let finish = () => {};
      const done = new Promise<void>((resolve) => { finish = resolve; });
      const stop = () => {
        if (ended) return;
        ended = true;
        clearInterval(timer);
        listeners.delete(notify);
        connections.delete(stop);
        c.req.raw.signal.removeEventListener('abort', stop);
        stream.abort();
        finish();
      };
      const current = () => {
        try {
          const value = freshActor(actor);
          if (value.role !== role) { stop(); return null; }
          return value;
        } catch { stop(); return null; }
      };
      const send = async (event: 'ready' | 'heartbeat' | 'change') => {
        if (ended || !current()) return;
        writing = true;
        try {
          await stream.writeSSE({ event, data: '{}', ...(event === 'ready' ? { retry: 3000 } : {}) });
          while (!ended && dirty) {
            dirty = false;
            if (!current()) break;
            await stream.writeSSE({ event: 'change', data: '{}' });
          }
        } catch { stop(); }
        finally { writing = false; }
      };
      const notify = (change: Change) => {
        const value = current();
        if (!value) return;
        const scope = value.role === 'employee' ? eq(orders.userId, value.id)
          : value.role === 'admin' ? undefined : or(eq(orders.userId, value.id), workScope(db, value));
        const relevant = change.kind === 'menu' || value.role === 'admin'
          || (change.kind === 'user' && (change.id === value.id || db.select({ id: orders.id }).from(orders)
            .where(and(eq(orders.assigneeId, change.id), scope)).get() !== undefined))
          || (change.kind === 'order' && ((value.role === 'staff' && change.wasPending)
            || db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, change.id),
              scope,
            )).get() !== undefined));
        if (!relevant) return;
        if (writing) dirty = true;
        else void send('change');
      };
      const timer = setInterval(() => {
        if (!current()) return;
        if (writing) { stop(); return; }
        void send('heartbeat');
      }, heartbeatMs);
      listeners.add(notify);
      connections.add(stop);
      stream.onAbort(stop);
      c.req.raw.signal.addEventListener('abort', stop, { once: true });
      if (c.req.raw.signal.aborted) stop();
      try {
        await send('ready');
        await done;
      } finally { stop(); }
    });
  });

  return {
    publish(change: Change) { if (!closed) for (const notify of listeners) notify(change); },
    close() {
      closed = true;
      for (const stop of connections) stop();
    },
  };
}

export type PublishChange = ReturnType<typeof createEvents>['publish'];
