import { expect, test } from 'vite-plus/test';
import {
  notificationPayloadSchema,
  notificationResources,
  notificationText,
  pushEndpointSchema,
  safeOrderTarget,
} from './notifications';

const id = '12345678-1234-4234-8234-123456789abc';
test('notification resources cover both languages and format reasons without interpolating credentials', () => {
  expect(Object.keys(notificationResources.bn).sort()).toEqual(
    Object.keys(notificationResources.en).sort(),
  );
  expect(
    notificationText({
      language: 'en',
      kind: 'cancel',
      target: '/orders?order=' + id,
      reason: 'Desk closed',
    }),
  ).toEqual({ title: 'Your request was cancelled', body: 'Reason: Desk closed' });
  expect(
    notificationText({
      language: 'bn',
      kind: 'reminder',
      target: '/work?order=' + id,
      reason: null,
    }),
  ).toEqual({ title: 'অনুরোধ এখনও অপেক্ষমাণ', body: 'অনুরোধ দেখতে খুলুন' });
});
test('notification navigation permits only internal order targets, not arbitrary redirects', () => {
  for (const path of ['/orders', '/work'])
    expect(safeOrderTarget(path + '?order=' + id)).toBe(path + '?order=' + id);
  for (const path of [
    'https://attacker.example/orders?order=' + id,
    '//attacker.example',
    '/users',
    '/orders?order=invalid',
    '/orders?order=' + id + '&next=https://attacker.example',
    '/work?order=' + id + '#other',
    '/%2fattack',
  ])
    expect(safeOrderTarget(path)).toBeNull();
  expect(
    notificationPayloadSchema.safeParse({
      language: 'en',
      kind: 'create',
      target: '/work?order=' + id,
      reason: null,
      note: 'private',
    }).success,
  ).toBe(false);
});
test('only documented HTTPS platform push endpoints are accepted', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/a',
    'https://updates.push.services.mozilla.com/wpush/v2/a',
    'https://web.push.apple.com/a',
    'https://web1.push.apple.com/a',
  ])
    expect(pushEndpointSchema.safeParse(endpoint).success).toBe(true);
  for (const endpoint of [
    'https://localhost/a',
    'https://10.0.0.1/a',
    'https://[::1]/a',
    'https://fcm.googleapis.com.evil.example/a',
    'http://fcm.googleapis.com/a',
    'https://web.push.apple.com/a#b',
    'https://user@web.push.apple.com/a',
  ])
    expect(pushEndpointSchema.safeParse(endpoint).success).toBe(false);
});
