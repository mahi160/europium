import { z } from 'zod';

const configSchema = z.strictObject({
  AUTH_SECRET: z.string().min(32).max(256),
  SETUP_TOKEN: z.string().min(32).max(256),
  APP_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  }),
  DATABASE_PATH: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  STATS_TOKEN: z
    .string()
    .min(32)
    .max(256)
    .regex(/^[A-Za-z0-9._~-]+$/)
    .optional(),
  OFFICE_TIMEZONE: z
    .string()
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function parseConfig(input: AppConfig): AppConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid backend configuration');
  return parsed.data;
}

export function envConfig(): AppConfig {
  const result = configSchema.safeParse({
    AUTH_SECRET: process.env.AUTH_SECRET,
    SETUP_TOKEN: process.env.SETUP_TOKEN,
    APP_ORIGIN: process.env.APP_ORIGIN,
    DATABASE_PATH: process.env.DATABASE_PATH,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    STATS_TOKEN: process.env.STATS_TOKEN || undefined,
    OFFICE_TIMEZONE: process.env.OFFICE_TIMEZONE || undefined,
  });
  if (!result.success) throw new Error('Invalid backend configuration');
  return result.data;
}
