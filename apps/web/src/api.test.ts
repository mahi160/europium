import { expect, test } from 'vite-plus/test';
import {
  menuItemResponseSchema,
  orderResponseSchema,
  pushConfigSchema,
} from '@office-service/shared';
import { sessionResponse } from './api';

const id = '12345678-1234-4234-8234-123456789abc';

test('an older client reads a session with new fields but requires its known fields', () => {
  const profile = {
    id,
    name: 'Employee',
    username: 'employee',
    role: 'employee',
    language: 'en',
    floor: '',
    desk: '',
    isActive: true,
  };
  const user = { ...profile, mustChangePassword: false };
  expect(sessionResponse.parse({ user: { ...user, newField: true }, newField: true })).toEqual({
    user,
  });
  expect(sessionResponse.safeParse({ user: profile }).success).toBe(false);
});

test('an older client ignores extra fields in an order, including nested items', () => {
  const item = { itemId: id, name: 'Tea', unit: 'কাপ', quantity: 1 };
  const order = {
    id,
    userId: id,
    status: 'PENDING',
    floor: '',
    desk: '',
    note: '',
    reason: null,
    createdAt: 1,
    updatedAt: 1,
    assignee: null,
    acceptedAt: null,
    completedAt: null,
    audit: [],
  };
  expect(
    orderResponseSchema.parse({
      order: { ...order, items: [{ ...item, newField: true }], newField: true },
    }),
  ).toEqual({ order: { ...order, items: [item] } });
  expect(orderResponseSchema.safeParse({ order }).success).toBe(false);
});

test('menu items and push configuration tolerate new server fields', () => {
  const item = { id, name: 'Tea', category: 'tea', unit: 'কাপ', available: true, archived: false };
  expect(
    menuItemResponseSchema.parse({ item: { ...item, newField: true }, newField: true }),
  ).toEqual({ item });
  expect(pushConfigSchema.parse({ publicKey: null, newField: true })).toEqual({ publicKey: null });
});
