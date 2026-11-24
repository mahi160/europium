import { randomUUID } from 'node:crypto';
import { test, expect } from './test';
import { type Page } from '@playwright/test';
import {
  menuItemResponseSchema,
  orderResponseSchema,
  ordersResponseSchema,
  setupSchema,
} from '@office-service/shared';

const origin = 'http://localhost:5183';
const headers = { Origin: origin };
const adminPassword = 'browser-admin-password-123';
const temporaryPassword = '0007';
const personalPassword = '0042';

async function configuredEmployee(page: Page) {
  const setup = await page.request.get('/api/setup');
  expect(setup.ok()).toBe(true);
  const status: unknown = await setup.json();
  if (
    typeof status === 'object' &&
    status !== null &&
    'setupRequired' in status &&
    status.setupRequired === true
  ) {
    const response = await page.request.post('/api/setup', {
      headers,
      data: setupSchema.parse({
        setupToken: 'browser-test-setup-token-32-characters',
        username: 'office_admin',
        password: adminPassword,
        name: 'অফিস প্রশাসক',
        language: 'en',
        floor: '',
        desk: '',
      }),
    });
    expect(response.status()).toBe(201);
  }
  const login = await page.request.post('/api/auth/login', {
    headers,
    data: { username: 'office_admin', password: adminPassword },
  });
  expect(login.status(), await login.text()).toBe(200);
  const unique = randomUUID().replaceAll('-', '').slice(0, 12);
  const name = 'দুধ চা ' + unique;
  const menu = await page.request.post('/api/menu', {
    headers,
    data: { name, category: 'tea', unit: 'কাপ', available: true, archived: false },
  });
  expect(menu.status()).toBe(201);
  const item = menuItemResponseSchema.parse(await menu.json()).item;
  const username = 'ordering_' + unique;
  const created = await page.request.post('/api/users', {
    headers,
    data: {
      name: 'চা-নাস্তার কর্মচারী',
      username,
      password: temporaryPassword,
      role: 'employee',
      language: 'en',
      floor: '৩',
      desk: 'D12',
    },
  });
  expect(created.status()).toBe(201);
  expect((await page.request.post('/api/auth/logout', { headers, data: {} })).ok()).toBe(true);
  expect(
    (
      await page.request.post('/api/auth/login', {
        headers,
        data: { username, password: temporaryPassword },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/auth/change-password', {
        headers,
        data: { currentPassword: temporaryPassword, newPassword: personalPassword },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: "Today's refreshments", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  return { item, name, username };
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`preconfigured personal order under 15 seconds at ${viewport.width}px, persisted draft and own cancellation`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { name } = await configuredEmployee(page);
    await expect(page.getByLabel('Floor', { exact: false })).toHaveCount(0);
    await expect(page.getByLabel('Desk', { exact: false })).toHaveCount(0);
    const started = Date.now();
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Send order (1)', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
    expect(Date.now() - started).toBeLessThan(15000);
    const card = page.getByRole('article').filter({ hasText: name });
    await expect(card.getByText('Pending', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Note (optional)', exact: true }).click();
    await page.getByLabel('Note (optional)', { exact: false }).fill('চিনি ছাড়া, গরম');
    await page.reload();
    await expect(page.getByLabel('Note (optional)', { exact: false })).toHaveValue('চিনি ছাড়া, গরম');
    await expect(page.getByRole('button', { name: 'Increase ' + name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Send order (1)', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
    const override = page.getByRole('article').filter({ hasText: 'চিনি ছাড়া' });
    await override.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(override.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(override.getByRole('button', { name: 'Cancel order', exact: true })).toHaveCount(
      0,
    );
    const saved = ordersResponseSchema.parse(
      await (await page.request.get('/api/orders')).json(),
    ).orders;
    expect(saved.every((order) => order.floor === '৩' && order.desk === 'D12')).toBe(true);
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Sign in', exact: true, level: 1 }),
    ).toBeVisible();
    const persisted = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('office-draft:')),
    );
    expect(persisted).toEqual([]);
  });
}

test('a lost successful response retries the frozen request after reload without a duplicate', async ({
  page,
}) => {
  const { name } = await configuredEmployee(page);
  let committedId = '';
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedId = orderResponseSchema.parse(await response.json()).order.id;
    await route.abort('failed');
  });
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Send order (1)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the office server');
  await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await page.unroute('**/api/orders');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry same order', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry same order', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
  const response = await page.request.get('/api/orders');
  expect(response.ok()).toBe(true);
  const result = ordersResponseSchema.parse(await response.json());
  expect(result.orders).toHaveLength(1);
  expect(result.orders[0].id).toBe(committedId);
});
