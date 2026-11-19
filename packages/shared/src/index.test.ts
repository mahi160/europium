import { expect, test } from 'vite-plus/test';
import {
  changePasswordSchema, createUserSchema, passwordSchema,
  updateProfileSchema, usernameSchema,
} from './index';

test('normalizes usernames and bounds credentials without trimming passwords', () => {
  expect(usernameSchema.parse('  OFFICE_ADMIN  ')).toBe('office_admin');
  expect(usernameSchema.safeParse('not valid').success).toBe(false);
  expect(usernameSchema.safeParse('a'.repeat(33)).success).toBe(false);
  expect(passwordSchema.safeParse('a'.repeat(11)).success).toBe(false);
  expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  expect(passwordSchema.parse(' password-123 ')).toBe(' password-123 ');
});

test('shared mutation schemas reject privilege injection and empty updates', () => {
  expect(updateProfileSchema.safeParse({ role: 'admin' }).success).toBe(false);
  expect(updateProfileSchema.safeParse({}).success).toBe(false);
  expect(updateProfileSchema.parse({ language: 'bn' })).toEqual({ language: 'bn' });
  expect(updateProfileSchema.safeParse({ floor: '৩', desk: 'D12' }).success).toBe(false);
  expect(createUserSchema.safeParse({
    name: 'User', username: 'user', password: 'password-12345', role: 'owner',
    language: 'bn', floor: '', desk: '',
  }).success).toBe(false);
  expect(changePasswordSchema.safeParse({
    currentPassword: 'same-password-123', newPassword: 'same-password-123',
  }).success).toBe(false);
});
