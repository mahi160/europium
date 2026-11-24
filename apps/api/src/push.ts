import { createECDH, ECDH } from 'node:crypto';
import { sendNotification } from 'web-push';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  pushEndpointSchema,
  pushSubscriptionSchema,
  type NotificationPayload,
} from '@office-service/shared';
import { AppError, input, type AppEnv, type CommandSecurity } from './app';
import type { AppConfig } from './config';
import type { openDatabase } from './database';

type Subscription = z.infer<typeof pushSubscriptionSchema>;
export type PushTransport = (
  subscription: Subscription,
  payload: NotificationPayload,
) => Promise<unknown>;
type Schedule = { order_id: string; history_id: number; initial: number };
type Event = {
  id: number;
  order_id: string;
  action: Exclude<NotificationPayload['kind'], 'claimed'>;
  to_status: string;
  reason: string | null;
  user_id: string;
};
type Recipient = {
  endpoint: string;
  p256dh: string;
  auth: string;
  language: 'bn' | 'en';
  user_id: string;
};
type Detail = { actor_id: string; actor_name: string; requested_name: string };
const intervalMs = 5 * 60 * 1000;

function vapid(config: AppConfig) {
  try {
    if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) return null;
    if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(config.VAPID_SUBJECT)) return null;
    const subject = new URL(config.VAPID_SUBJECT);
    if (subject.protocol !== 'mailto:' && subject.protocol !== 'https:') return null;
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(config.VAPID_PRIVATE_KEY, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== config.VAPID_PUBLIC_KEY) return null;
    return {
      subject: config.VAPID_SUBJECT,
      publicKey: config.VAPID_PUBLIC_KEY,
      privateKey: config.VAPID_PRIVATE_KEY,
    };
  } catch {
    return null;
  }
}

export function createPush(
  { sqlite }: ReturnType<typeof openDatabase>,
  config: AppConfig,
  options: { clock?: () => number; transport?: PushTransport } = {},
) {
  const details = vapid(config);
  const clock = options.clock ?? Date.now;
  const transport: PushTransport =
    options.transport ??
    ((subscription, payload) =>
      sendNotification(subscription, JSON.stringify(payload), {
        vapidDetails: details ?? undefined,
        TTL: 60,
        timeout: 10000,
        urgency: 'high',
      }));
  const publicKey = details?.publicKey ?? null;
  let running: Promise<void> | null = null;
  let stopped = false;
  const recipients = sqlite.prepare<Recipient, [number, string, string]>(`
    SELECT p.endpoint, p.p256dh, p.auth, u.language, u.id AS user_id FROM push_subscription p
    JOIN user u ON u.id = p.user_id JOIN session s ON s.id = p.session_id AND s.user_id = u.id
    WHERE u.banned = 0 AND u.must_change_password = 0 AND s.expires_at > ?
      AND ((? = 'staff' AND u.role = 'staff') OR u.id = ?)
    ORDER BY p.endpoint
  `);
  const validRecipient = sqlite.prepare<Recipient, [string, number, string, string]>(`
    SELECT p.endpoint, p.p256dh, p.auth, u.language, u.id AS user_id FROM push_subscription p
    JOIN user u ON u.id = p.user_id JOIN session s ON s.id = p.session_id AND s.user_id = u.id
    WHERE p.endpoint = ? AND u.banned = 0 AND u.must_change_password = 0 AND s.expires_at > ?
      AND ((? = 'staff' AND u.role = 'staff') OR u.id = ?)
  `);
  const latest = sqlite.prepare<{ id: string }, [string, string, number]>(`
    SELECT id FROM orders WHERE id = ? AND status = ?
      AND (SELECT max(id) FROM order_history WHERE order_id = orders.id) = ?
  `);
  async function deliver(
    event: Event,
    staff: boolean,
    kind: Exclude<NotificationPayload['kind'], 'claimed'>,
    detail?: Detail,
  ) {
    const scope = staff ? 'staff' : 'employee';
    const owner = staff ? '' : event.user_id;
    for (const candidate of recipients.all(clock(), scope, owner)) {
      if (stopped) return;
      const recipient = validRecipient.get(candidate.endpoint, clock(), scope, owner);
      if (!recipient || recipient.p256dh !== candidate.p256dh || recipient.auth !== candidate.auth)
        continue;
      if (detail && (recipient.user_id === detail.actor_id || recipient.user_id === event.user_id))
        continue;
      if (
        staff
          ? !latest.get(event.order_id, detail ? 'ACCEPTED' : 'PENDING', event.id)
          : !sqlite
              .prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?')
              .get(event.order_id, event.user_id)
      )
        return;
      const payload: NotificationPayload = detail
        ? {
            language: recipient.language,
            kind: 'claimed',
            target: '/work',
            reason: null,
            id: event.id,
            requestedBy: detail.requested_name,
            acceptedBy: detail.actor_name,
          }
        : {
            language: recipient.language,
            kind,
            target: `/${staff ? 'work' : 'orders'}?order=${event.order_id}`,
            reason: staff ? null : event.reason,
          };
      try {
        await transport(
          {
            endpoint: recipient.endpoint,
            keys: { p256dh: recipient.p256dh, auth: recipient.auth },
          },
          payload,
        );
      } catch (error) {
        if (stopped) return;
        if (
          error &&
          typeof error === 'object' &&
          'statusCode' in error &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          sqlite
            .prepare('DELETE FROM push_subscription WHERE endpoint = ? AND p256dh = ? AND auth = ?')
            .run(recipient.endpoint, recipient.p256dh, recipient.auth);
        }
      }
    }
  }
  const eventById = sqlite.prepare<Event, [number]>(`
    SELECT h.id, h.order_id, h.action, h.to_status, h.reason, o.user_id
    FROM order_history h JOIN orders o ON o.id = h.order_id WHERE h.id = ?
  `);
  const detailById = sqlite.prepare<Detail, [number]>(`
    SELECT h.actor_id, h.actor_name, u.name AS requested_name
    FROM order_history h JOIN orders o ON o.id = h.order_id JOIN user u ON u.id = o.user_id WHERE h.id = ?
  `);
  async function flush() {
    if (!publicKey || stopped) return;
    const events = sqlite
      .prepare<{ history_id: number }, []>('SELECT history_id FROM push_event ORDER BY history_id')
      .all();
    for (const value of events) {
      if (stopped) return;
      if (
        !sqlite.prepare('DELETE FROM push_event WHERE history_id = ?').run(value.history_id).changes
      )
        continue;
      const event = eventById.get(value.history_id);
      if (!event) continue;
      const detail = event.action === 'accept' ? detailById.get(event.id) : undefined;
      if (detail) await deliver(event, true, 'accept', detail);
      await deliver(event, false, event.action);
    }
    if (stopped) return;
    const now = clock();
    const due = sqlite
      .transaction(() => {
        const values = sqlite
          .prepare<Schedule, [number]>(
            'SELECT order_id, history_id, initial FROM push_schedule WHERE due_at <= ? ORDER BY due_at',
          )
          .all(now);
        sqlite
          .prepare('UPDATE push_schedule SET due_at = ?, initial = 0 WHERE due_at <= ?')
          .run(now + intervalMs, now);
        return values;
      })
      .immediate();
    for (const value of due) {
      if (stopped) return;
      const event = eventById.get(value.history_id);
      if (event) await deliver(event, true, value.initial ? 'create' : 'reminder');
    }
  }
  function tick() {
    if (!running)
      running = flush().finally(() => {
        running = null;
      });
    return running;
  }
  return {
    publicKey,
    tick,
    stop: () => {
      stopped = true;
    },
    drain: () => running ?? Promise.resolve(),
  };
}

export function registerPush(
  app: Hono<AppEnv>,
  database: ReturnType<typeof openDatabase>,
  security: CommandSecurity,
  push: ReturnType<typeof createPush>,
) {
  const { sqlite } = database;
  app.get('/api/push/config', async (c) => {
    await security.actorFor(c);
    return c.json({ publicKey: push.publicKey });
  });
  app.post('/api/push/subscription', async (c) => {
    const actor = await security.actorFor(c);
    const data = input(c, pushSubscriptionSchema);
    if (!push.publicKey) throw new AppError('FORBIDDEN', 403);
    try {
      ECDH.convertKey(Buffer.from(data.keys.p256dh, 'base64url'), 'prime256v1');
      if (
        Buffer.from(data.keys.p256dh, 'base64url').toString('base64url') !== data.keys.p256dh ||
        Buffer.from(data.keys.auth, 'base64url').toString('base64url') !== data.keys.auth
      )
        throw new Error();
    } catch {
      throw new AppError('VALIDATION_ERROR');
    }
    sqlite
      .transaction(() => {
        security.freshActor(actor);
        const current = sqlite
          .prepare<{ id: string }, [string]>('SELECT id FROM session WHERE token = ?')
          .get(actor.token);
        if (!current) throw new AppError('UNAUTHORIZED', 401);
        sqlite
          .prepare(`INSERT INTO push_subscription (endpoint, user_id, session_id, p256dh, auth) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, session_id = excluded.session_id,
          p256dh = excluded.p256dh, auth = excluded.auth`)
          .run(data.endpoint, actor.userId, current.id, data.keys.p256dh, data.keys.auth);
      })
      .immediate();
    return c.json({ success: true });
  });
  app.delete('/api/push/subscription', async (c) => {
    const actor = await security.actorFor(c);
    const data = input(c, z.strictObject({ endpoint: pushEndpointSchema }));
    sqlite
      .transaction(() => {
        security.freshActor(actor);
        sqlite
          .prepare(`DELETE FROM push_subscription WHERE endpoint = ? AND user_id = ?
        AND session_id = (SELECT id FROM session WHERE token = ?)`)
          .run(data.endpoint, actor.userId, actor.token);
      })
      .immediate();
    return c.json({ success: true });
  });
}
