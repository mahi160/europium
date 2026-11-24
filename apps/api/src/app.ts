import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { z } from 'zod';
import {
  changePasswordSchema, createUserSchema, loginSchema, passwordSchema, pinSchema, resetPasswordSchema,
  setupSchema, updateProfileSchema, updateUserSchema, userIdSchema,
  type ApiErrorCode, type PublicUser,
} from '@office-service/shared';
import { createAuth } from './auth';
import { parseConfig, type AppConfig } from './config';
import { openDatabase } from './database';
import { account, menuItem, rateLimit, session, setup, user } from './schema';
import { registerOrders } from './orders';
import { createEvents } from './events';
import { createPush, registerPush, type PushTransport } from './push';

export class AppError extends Error {
  constructor(public code: ApiErrorCode, public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 = 400) {
    super(code);
  }
}

export type Actor = { userId: string; token: string };
export type AppEnv = { Variables: { body: unknown } };
type User = typeof user.$inferSelect;
export type CommandSecurity = {
  actorFor: (c: Context<AppEnv>, adminOnly?: boolean) => Promise<Actor>;
  freshActor: (actor: Actor, adminOnly?: boolean) => User;
};

// Common office refreshments, seeded once at first setup; admins edit them like any item.
const presetMenu = [
  { name: 'রং চা', category: 'tea', unit: 'কাপ' },
  { name: 'দুধ চা', category: 'tea', unit: 'কাপ' },
  { name: 'ব্ল্যাক কফি', category: 'coffee', unit: 'কাপ' },
  { name: 'হোয়াইট কফি', category: 'coffee', unit: 'কাপ' },
  { name: 'পানি', category: 'water', unit: 'গ্লাস' },
  { name: 'বিস্কুট', category: 'snack', unit: 'প্যাকেট' },
  { name: 'চানাচুর', category: 'snack', unit: 'বাটি' },
  { name: 'মুড়ি', category: 'snack', unit: 'বাটি' },
] as const;

function publicUser(value: User): PublicUser {
  return {
    id: value.id, name: value.name, username: value.username, role: value.role,
    language: value.language, floor: value.floor, desk: value.desk,
    isActive: !value.banned, mustChangePassword: value.mustChangePassword,
  };
}

export function input<T>(c: Context<AppEnv>, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(c.get('body'));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR');
  return parsed.data;
}

export function createApp(options: AppConfig, realtime: { heartbeatMs?: number; clock?: () => number; transport?: PushTransport } = {}) {
  const config = parseConfig(options);
  const { sqlite, db } = openDatabase(config.DATABASE_PATH);
  const auth = createAuth(db, config);
  const app = new Hono<AppEnv>();
  const findUser = (id: string) => db.select().from(user).where(and(eq(user.id, id), isNull(user.deletedAt))).get();
  const credential = (id: string) => db.select().from(account)
    .where(and(eq(account.userId, id), eq(account.providerId, 'credential'))).get();

  function freshActor(actor: Actor, adminOnly = false, allowTemporary = false): User {
    const currentSession = db.select().from(session).where(eq(session.token, actor.token)).get();
    const current = findUser(actor.userId);
    if (!currentSession || currentSession.userId !== actor.userId || currentSession.expiresAt.getTime() <= Date.now() || !current || current.banned) {
      throw new AppError('UNAUTHORIZED', 401);
    }
    if (!allowTemporary && current.mustChangePassword) throw new AppError('PASSWORD_CHANGE_REQUIRED', 403);
    if (adminOnly && current.role !== 'admin') throw new AppError('FORBIDDEN', 403);
    return current;
  }

  async function actorFor(c: Context<AppEnv>, adminOnly = false, allowTemporary = false): Promise<Actor> {
    const result = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
    if (!result) throw new AppError('UNAUTHORIZED', 401);
    const actor = { userId: result.user.id, token: result.session.token };
    freshActor(actor, adminOnly, allowTemporary);
    return actor;
  }

  // A separate server secret prevents a database-only attacker from enumerating all 10,000 PINs.
  function encodedCredential(person: Pick<User, 'role' | 'username'>, value: string) {
    return person.role === 'admin' ? value : createHmac('sha256', config.AUTH_SECRET)
      .update(JSON.stringify(['pin', person.username, value])).digest('hex');
  }

  function credentialLimit(username: string) {
    return 'credential:' + createHash('sha256').update(username).digest('hex');
  }

  function limited(key: string, limit: number, windowMs = 60000) {
    sqlite.transaction(() => {
      const window = Math.floor(Date.now() / windowMs);
      const previous = db.select().from(rateLimit).where(eq(rateLimit.key, key)).get();
      if (previous?.window === window) {
        if (previous.count >= limit) throw new AppError('RATE_LIMITED', 429);
        db.update(rateLimit).set({ count: previous.count + 1 }).where(eq(rateLimit.key, key)).run();
      } else if (previous) {
        db.update(rateLimit).set({ window, count: 1 }).where(eq(rateLimit.key, key)).run();
      } else {
        db.insert(rateLimit).values({ key, window, count: 1 }).run();
      }
    }).immediate();
  }

  function protectLastAdmin(target: User, nextRole: User['role'], nextActive: boolean) {
    if (target.role !== 'admin' || target.banned || (nextRole === 'admin' && nextActive)) return;
    const admins = db.select({ id: user.id }).from(user)
      .where(and(eq(user.role, 'admin'), eq(user.banned, false), isNull(user.deletedAt))).all();
    if (admins.length <= 1) throw new AppError('LAST_ACTIVE_ADMIN', 409);
  }

  app.onError((error, c) => error instanceof AppError
    ? c.json({ error: { code: error.code } }, error.status)
    : c.json({ error: { code: 'INTERNAL_ERROR' } }, 500));
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND' } }, 404));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    if (c.req.path === '/api/events' && ((c.req.header('Origin') !== undefined && c.req.header('Origin') !== config.APP_ORIGIN)
      || c.req.header('Sec-Fetch-Site') === 'cross-site' || c.req.header('Sec-Fetch-Site') === 'same-site')) {
      throw new AppError('INVALID_ORIGIN', 403);
    }
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      if (c.req.header('Origin') !== config.APP_ORIGIN) throw new AppError('INVALID_ORIGIN', 403);
      if (c.req.path === '/api/setup') limited('setup', 10);
      if (c.req.path === '/api/auth/login') limited('login', 30);
      if (c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json') throw new AppError('VALIDATION_ERROR');
      const reader = c.req.raw.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16384) {
            await reader.cancel();
            throw new AppError('BODY_TOO_LARGE', 413);
          }
          chunks.push(part.value);
        }
      }
      try {
        c.set('body', JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        throw new AppError('VALIDATION_ERROR');
      }
    }
    await next();
  });

  const events = createEvents(app, { db, sqlite }, { actorFor, freshActor }, realtime.heartbeatMs);

  app.get('/api/setup', (c) => c.json({ setupRequired: !db.select().from(setup).get() }));
  app.post('/api/setup', async (c) => {
    const data = input(c, setupSchema);
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(data.setupToken), digest(config.SETUP_TOKEN))) throw new AppError('INVALID_SETUP_TOKEN', 403);
    if (db.select().from(setup).get()) throw new AppError('SETUP_COMPLETE', 409);
    const password = await hashPassword(data.password);
    const created = sqlite.transaction(() => {
      if (db.select().from(setup).get()) throw new AppError('SETUP_COMPLETE', 409);
      const id = randomUUID();
      const now = new Date();
      db.insert(user).values({
        id, name: data.name, username: data.username, displayUsername: data.username,
        email: `${id}@office.invalid`, emailVerified: true, role: 'admin',
        language: data.language, floor: data.floor, desk: data.desk,
        mustChangePassword: false, createdAt: now, updatedAt: now,
      }).run();
      db.insert(account).values({
        id: randomUUID(), accountId: id, providerId: 'credential', userId: id,
        password, createdAt: now, updatedAt: now,
      }).run();
      db.insert(setup).values({ id: 1, userId: id }).run();
      db.insert(menuItem).values(presetMenu.map((item) => ({ id: randomUUID(), ...item, available: true, archived: false }))).run();
      const result = findUser(id);
      if (!result) throw new Error('Account creation failed');
      return result;
    }).immediate();
    events.publish({ kind: 'user', id: created.id });
    return c.json({ user: publicUser(created) }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const data = input(c, loginSchema);
    const limitKey = credentialLimit(data.username);
    limited(limitKey, 5, 15 * 60000);
    const before = db.select().from(user).where(eq(user.username, data.username)).get();
    const passwordBefore = before ? credential(before.id)?.password : undefined;
    const response = await auth.api.signInUsername({
      body: { ...data, password: before ? encodedCredential(before, data.password) : data.password },
      headers: c.req.raw.headers, asResponse: true,
    });
    if (!response.ok) throw new AppError('INVALID_CREDENTIALS', 401);
    const signedIn = z.object({ token: z.string(), user: z.object({ id: z.string() }) }).parse(await response.json());
    const current = sqlite.transaction(() => {
      const value = findUser(signedIn.user.id);
      if (!value || value.banned || value.role !== before?.role || !passwordBefore || credential(value.id)?.password !== passwordBefore) {
        db.delete(session).where(eq(session.token, signedIn.token)).run();
        return null;
      }
      db.delete(rateLimit).where(eq(rateLimit.key, limitKey)).run();
      return value;
    }).immediate();
    if (!current) throw new AppError('INVALID_CREDENTIALS', 401);
    for (const cookie of response.headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    return c.json({ user: publicUser(current) });
  });

  app.get('/api/auth/get-session', async (c) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
    if (!result) return c.json({ user: null });
    try {
      const current = freshActor({ userId: result.user.id, token: result.session.token }, false, true);
      return c.json({ user: publicUser(current) });
    } catch (error) {
      if (error instanceof AppError && error.code === 'UNAUTHORIZED') return c.json({ user: null });
      throw error;
    }
  });

  app.post('/api/auth/logout', async (c) => {
    const actor = await actorFor(c, false, true);
    sqlite.transaction(() => {
      freshActor(actor, false, true);
      db.delete(session).where(eq(session.token, actor.token)).run();
    }).immediate();
    events.publish({ kind: 'user', id: actor.userId });
    const response = await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true });
    for (const cookie of response.headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    return c.json({ success: true });
  });

  app.post('/api/auth/change-password', async (c) => {
    const actor = await actorFor(c, false, true);
    const parsed = changePasswordSchema.safeParse(c.get('body'));
    if (!parsed.success) {
      const unchanged = parsed.error.issues.some((issue) => issue.code === 'custom');
      throw new AppError(unchanged ? 'CREDENTIAL_UNCHANGED' : 'VALIDATION_ERROR');
    }
    const data = parsed.data;
    const person = freshActor(actor, false, true);
    if (!(person.role === 'admin' ? passwordSchema : pinSchema).safeParse(data.newPassword).success) throw new AppError('VALIDATION_ERROR');
    const limitKey = credentialLimit(person.username);
    limited(limitKey, 5, 15 * 60000);
    const previous = credential(actor.userId);
    if (!previous?.password || !await verifyPassword({ hash: previous.password, password: encodedCredential(person, data.currentPassword) })) {
      throw new AppError('INVALID_CURRENT_PASSWORD');
    }
    const password = await hashPassword(encodedCredential(person, data.newPassword));
    sqlite.transaction(() => {
      freshActor(actor, false, true);
      if (credential(actor.userId)?.password !== previous.password) throw new AppError('UNAUTHORIZED', 401);
      const now = new Date();
      db.update(account).set({ password, updatedAt: now }).where(eq(account.id, previous.id)).run();
      db.update(user).set({ mustChangePassword: false, updatedAt: now }).where(eq(user.id, actor.userId)).run();
      db.delete(rateLimit).where(eq(rateLimit.key, limitKey)).run();
      const sessions = db.select().from(session).where(eq(session.userId, actor.userId)).all();
      for (const value of sessions) {
        if (value.token !== actor.token) db.delete(session).where(eq(session.id, value.id)).run();
      }
    }).immediate();
    events.publish({ kind: 'user', id: actor.userId });
    const current = findUser(actor.userId);
    if (!current) throw new AppError('UNAUTHORIZED', 401);
    return c.json({ user: publicUser(current) });
  });

  app.patch('/api/me', async (c) => {
    const actor = await actorFor(c);
    const data = input(c, updateProfileSchema);
    const result = sqlite.transaction(() => {
      const previous = freshActor(actor);
      const current = db.update(user).set({ ...data, updatedAt: new Date() }).where(eq(user.id, actor.userId)).returning().get();
      return { current, changed: JSON.stringify(publicUser(previous)) !== JSON.stringify(publicUser(current)) };
    }).immediate();
    if (result.changed) events.publish({ kind: 'user', id: actor.userId });
    return c.json({ user: publicUser(result.current) });
  });

  app.get('/api/users', async (c) => {
    await actorFor(c, true);
    return c.json({ users: db.select().from(user).where(isNull(user.deletedAt)).all().map(publicUser) });
  });

  app.post('/api/users', async (c) => {
    await actorFor(c, true);
    const data = input(c, createUserSchema);
    if (db.select().from(user).where(eq(user.username, data.username)).get()) throw new AppError('USERNAME_TAKEN', 409);
    try {
      const result = await auth.api.createUser({
        headers: c.req.raw.headers,
        body: {
          email: `${randomUUID()}@office.invalid`, password: encodedCredential(data, data.password), name: data.name, role: data.role,
          data: { username: data.username, displayUsername: data.username, language: data.language, floor: data.floor, desk: data.desk, mustChangePassword: true },
        },
      });
      const current = findUser(result.user.id);
      if (!current) throw new Error('Account creation failed');
      events.publish({ kind: 'user', id: current.id });
      return c.json({ user: publicUser(current) }, 201);
    } catch (error) {
      if (db.select().from(user).where(eq(user.username, data.username)).get()) throw new AppError('USERNAME_TAKEN', 409);
      throw error;
    }
  });

  app.patch('/api/users/:id', async (c) => {
    const actor = await actorFor(c, true);
    const id = userIdSchema.safeParse(c.req.param('id'));
    if (!id.success) throw new AppError('VALIDATION_ERROR');
    const data = input(c, updateUserSchema);
    const updated = sqlite.transaction(() => {
      freshActor(actor, true);
      const target = findUser(id.data);
      if (!target) throw new AppError('USER_NOT_FOUND', 404);
      protectLastAdmin(target, data.role ?? target.role, data.isActive ?? !target.banned);
      const { isActive, ...fields } = data;
      const credentialChanged = data.role !== undefined && (data.role === 'admin') !== (target.role === 'admin');
      const current = db.update(user).set({
        ...fields, ...(isActive === undefined ? {} : { banned: !isActive, banReason: null, banExpires: null }),
        ...(credentialChanged ? { mustChangePassword: true } : {}),
        updatedAt: new Date(),
      }).where(eq(user.id, target.id)).returning().get();
      if (credentialChanged) db.update(account).set({ password: null, updatedAt: new Date() })
        .where(and(eq(account.userId, target.id), eq(account.providerId, 'credential'))).run();
      if (isActive === false || credentialChanged) db.delete(session).where(eq(session.userId, target.id)).run();
      return { current, changed: JSON.stringify(publicUser(target)) !== JSON.stringify(publicUser(current)) };
    }).immediate();
    if (updated.changed) events.publish({ kind: 'user', id: id.data });
    return c.json({ user: publicUser(updated.current) });
  });

  app.delete('/api/users/:id', async (c) => {
    const actor = await actorFor(c, true);
    const id = userIdSchema.safeParse(c.req.param('id'));
    if (!id.success) throw new AppError('VALIDATION_ERROR');
    sqlite.transaction(() => {
      freshActor(actor, true);
      const target = findUser(id.data);
      if (!target) throw new AppError('USER_NOT_FOUND', 404);
      protectLastAdmin(target, target.role, false);
      const now = new Date();
      db.update(user).set({ deletedAt: now, banned: true, banExpires: null, updatedAt: now })
        .where(eq(user.id, target.id)).run();
      db.delete(session).where(eq(session.userId, target.id)).run();
    }).immediate();
    events.publish({ kind: 'user', id: id.data });
    return c.json({ success: true });
  });

  app.post('/api/users/:id/reset-password', async (c) => {
    const actor = await actorFor(c, true);
    const id = userIdSchema.safeParse(c.req.param('id'));
    if (!id.success) throw new AppError('VALIDATION_ERROR');
    const data = input(c, resetPasswordSchema);
    const person = findUser(id.data);
    if (!person) throw new AppError('USER_NOT_FOUND', 404);
    if (!(person.role === 'admin' ? passwordSchema : pinSchema).safeParse(data.newPassword).success) throw new AppError('VALIDATION_ERROR');
    const password = await hashPassword(encodedCredential(person, data.newPassword));
    sqlite.transaction(() => {
      freshActor(actor, true);
      const current = findUser(id.data);
      if (!current) throw new AppError('USER_NOT_FOUND', 404);
      if (current.role !== person.role) throw new AppError('VALIDATION_ERROR');
      const target = credential(id.data);
      if (!target) throw new Error('Credential account missing');
      const now = new Date();
      db.update(account).set({ password, updatedAt: now }).where(eq(account.id, target.id)).run();
      db.update(user).set({ mustChangePassword: true, updatedAt: now }).where(eq(user.id, id.data)).run();
      db.delete(session).where(eq(session.userId, id.data)).run();
      db.delete(rateLimit).where(eq(rateLimit.key, credentialLimit(person.username))).run();
    }).immediate();
    events.publish({ kind: 'user', id: id.data });
    return c.json({ success: true });
  });

  registerOrders(app, { db, sqlite }, { actorFor, freshActor }, events.publish);
  const push = createPush({ db, sqlite }, config, realtime);
  registerPush(app, { db, sqlite }, { actorFor, freshActor }, push);
  let closed = false;
  return { app, db, sqlite, auth, push, close: () => {
    if (closed) return;
    closed = true;
    events.close();
    push.stop();
    sqlite.close();
  } };
}
