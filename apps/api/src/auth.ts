import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, username } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import type { AppConfig } from './config';
import type { openDatabase } from './database';
import * as schema from './schema';

export function createAuth(db: ReturnType<typeof openDatabase>['db'], config: AppConfig) {
  return betterAuth({
    secret: config.AUTH_SECRET,
    baseURL: config.APP_ORIGIN,
    basePath: '/api/auth',
    trustedOrigins: [config.APP_ORIGIN],
    database: drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        language: { type: ['bn', 'en'], required: false, defaultValue: 'bn', input: false },
        floor: { type: 'string', required: false, defaultValue: '', input: false },
        desk: { type: 'string', required: false, defaultValue: '', input: false },
        mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (value) => /^[a-z0-9_]+$/.test(value),
      }),
      admin({
        defaultRole: 'employee',
        roles: { admin: adminAc, employee: userAc, staff: userAc },
      }),
    ],
    logger: { disabled: true },
  });
}
