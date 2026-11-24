import { expect, test } from 'vite-plus/test';
import {
  changePasswordSchema,
  createUserSchema,
  passwordSchema,
  pinSchema,
  resetPasswordSchema,
} from './index';

const profile = { name: 'Person', username: 'person', language: 'en', floor: '', desk: '' };

test('PINs are exactly four ASCII digits and preserve leading zeros as strings', () => {
  expect(pinSchema.parse('0007')).toBe('0007');
  for (const value of [
    1234,
    null,
    '',
    '123',
    '12345',
    '12a4',
    '１２３４',
    '১২৩৪',
    ' 1234',
    '1234 ',
    '1234\n',
  ]) {
    expect(pinSchema.safeParse(value).success).toBe(false);
  }
  expect(passwordSchema.safeParse('0007').success).toBe(false);
});

test('account creation validates credentials by role', () => {
  for (const role of ['employee', 'staff']) {
    expect(createUserSchema.safeParse({ ...profile, role, password: '0007' }).success).toBe(true);
    expect(
      createUserSchema.safeParse({ ...profile, role, password: 'long-password-123' }).success,
    ).toBe(false);
  }
  expect(createUserSchema.safeParse({ ...profile, role: 'admin', password: '0007' }).success).toBe(
    false,
  );
  expect(
    createUserSchema.safeParse({ ...profile, role: 'admin', password: 'long-password-123' })
      .success,
  ).toBe(true);
});

test('new employee and staff accounts default to 0000 without creating an administrator password default', () => {
  for (const role of ['employee', 'staff'])
    expect(createUserSchema.parse({ ...profile, role }).password).toBe('0000');
  expect(createUserSchema.safeParse({ ...profile, role: 'admin' }).success).toBe(false);
});

test('credential changes and resets accept PINs or administrator passwords but never malformed short strings', () => {
  expect(
    changePasswordSchema.safeParse({ currentPassword: '0007', newPassword: '0042' }).success,
  ).toBe(true);
  expect(
    changePasswordSchema.safeParse({ currentPassword: '0007', newPassword: '0007' }).success,
  ).toBe(false);
  expect(resetPasswordSchema.safeParse({ newPassword: '0042' }).success).toBe(true);
  expect(resetPasswordSchema.safeParse({ newPassword: '12a4' }).success).toBe(false);
});
