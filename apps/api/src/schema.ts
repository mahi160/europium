import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { menuCategories, orderActions, orderStatuses } from '@office-service/shared';

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  username: text('username').notNull().unique(),
  displayUsername: text('display_username'),
  role: text('role', { enum: ['employee', 'staff', 'admin'] }).notNull().default('employee'),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
  language: text('language', { enum: ['bn', 'en'] }).notNull().default('bn'),
  floor: text('floor').notNull().default(''),
  desk: text('desk').notNull().default(''),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const setup = sqliteTable('setup', {
  id: integer('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id),
});

export const menuItem = sqliteTable('menu_item', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category', { enum: menuCategories }).notNull(),
  unit: text('unit').notNull(),
  available: integer('available', { mode: 'boolean' }).notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull(),
});

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  status: text('status', { enum: orderStatuses }).notNull(),
  floor: text('floor').notNull(),
  desk: text('desk').notNull(),
  note: text('note').notNull(),
  reason: text('reason'),
  assigneeId: text('assignee_id').references(() => user.id),
  acceptedAt: integer('accepted_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('orders_user_key').on(table.userId, table.idempotencyKey)]);

export const orderHistory = sqliteTable('order_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: text('order_id').notNull().references(() => orders.id),
  action: text('action', { enum: orderActions }).notNull(),
  actorId: text('actor_id').notNull().references(() => user.id),
  actorName: text('actor_name').notNull(),
  at: integer('at').notNull(),
  fromStatus: text('from_status', { enum: orderStatuses }),
  toStatus: text('to_status', { enum: orderStatuses }).notNull(),
  fromAssigneeId: text('from_assignee_id').references(() => user.id),
  assigneeId: text('assignee_id').references(() => user.id),
  assigneeName: text('assignee_name').notNull().default(''),
  reason: text('reason'),
});

export const orderItem = sqliteTable('order_item', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id),
  itemId: text('item_id').notNull().references(() => menuItem.id),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  quantity: integer('quantity').notNull(),
});

export const rateLimit = sqliteTable('rate_limit', {
  key: text('key').primaryKey(),
  window: integer('window').notNull(),
  count: integer('count').notNull(),
});
