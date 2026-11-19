import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { menuItemResponseSchema, orderResponseSchema, ordersResponseSchema, setupSchema } from '@office-service/shared';

const headers = { Origin: 'http://localhost:5183' };
const adminPassword = 'browser-admin-password-123';
const temporaryPassword = 'fulfillment-temporary-password-123';
const personalPassword = 'fulfillment-personal-password-456';

async function signIn(page: Page, username: string, password: string) {
  expect((await page.request.post('/api/auth/login', { headers, data: { username, password } })).ok()).toBe(true);
}
async function signOut(page: Page) {
  expect((await page.request.post('/api/auth/logout', { headers, data: {} })).ok()).toBe(true);
}
async function configuredOffice(page: Page) {
  const setup = await page.request.get('/api/setup');
  expect(setup.ok()).toBe(true);
  const status: unknown = await setup.json();
  if (typeof status === 'object' && status !== null && 'setupRequired' in status && status.setupRequired === true) {
    const response = await page.request.post('/api/setup', { headers, data: setupSchema.parse({
      setupToken: 'browser-test-setup-token-32-characters', username: 'office_admin', password: adminPassword,
      name: 'অফিস প্রশাসক', language: 'en', floor: '', desk: '',
    }) });
    expect(response.status()).toBe(201);
  }
  await signIn(page, 'office_admin', adminPassword);
  expect((await page.request.patch('/api/me', { headers, data: { language: 'en' } })).ok()).toBe(true);
  const unique = randomUUID().replaceAll('-', '').slice(0, 12);
  const name = 'চা ' + unique;
  const menu = await page.request.post('/api/menu', { headers, data: { name, category: 'tea', unit: 'কাপ', available: true, archived: false } });
  expect(menu.status()).toBe(201);
  const item = menuItemResponseSchema.parse(await menu.json()).item;
  const people = { employee: 'request_' + unique, staff: 'fulfill_' + unique };
  for (const role of ['employee', 'staff'] as const) {
    const created = await page.request.post('/api/users', { headers, data: {
      name: role === 'staff' ? 'সহায়তাকর্মী' : 'অর্ডারকারী', username: people[role], password: temporaryPassword,
      role, language: 'en', floor: '৩', desk: 'D12',
    } });
    expect(created.status()).toBe(201);
  }
  for (const role of ['staff', 'employee'] as const) {
    await signOut(page);
    await signIn(page, people[role], temporaryPassword);
    expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: temporaryPassword, newPassword: personalPassword } })).ok()).toBe(true);
  }
  return { ...people, item, name };
}

test('employee UI submission, staff whole-order delivery, and audited admin requeue', async ({ page }) => {
  const { employee, staff, name } = await configuredOffice(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Order refreshments', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Increase ' + name, exact: true }).click();
  await page.getByLabel('Note (optional)', { exact: false }).fill('চিনি ছাড়া');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
  await page.getByRole('button', { name: 'Increase ' + name, exact: true }).click();
  await page.getByLabel('Note (optional)', { exact: false }).fill('Meeting room');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Meeting room' })).toBeVisible();
  const mine = await page.request.get('/api/orders');
  expect(mine.ok()).toBe(true);
  const personalOrders = ordersResponseSchema.parse(await mine.json()).orders;
  expect(personalOrders).toHaveLength(2);
  expect(personalOrders.every((order) => order.floor === '৩' && order.desk === 'D12')).toBe(true);
  const first = personalOrders.find((order) => order.note !== 'Meeting room');
  const second = personalOrders.find((order) => order.note === 'Meeting room');
  expect(first).toBeDefined(); expect(second).toBeDefined();
  if (!first || !second) throw new Error('Submitted orders missing');
  await signOut(page);
  await signIn(page, staff, personalPassword);
  await page.goto('/work');
  await expect(page.getByRole('heading', { name: 'Oldest requests first', exact: true })).toBeVisible();
  const firstCard = page.getByRole('article').filter({ hasText: name }).filter({ hasNotText: 'Meeting room' });
  const secondCard = page.getByRole('article').filter({ hasText: name }).filter({ hasText: 'Meeting room' });
  await expect(firstCard).toContainText('চিনি ছাড়া');
  await expect(firstCard).toContainText('Waiting');
  await expect(firstCard).toContainText('Desk D12');
  await page.screenshot({ path: 'test-results/fulfillment-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/fulfillment-phone.png', fullPage: true });
  await firstCard.getByRole('button', { name: 'Accept order', exact: true }).click();
  await expect(firstCard).toHaveCount(0);
  await page.getByRole('button', { name: 'My active work', exact: true }).click();
  await expect(firstCard.getByRole('heading', { name: 'Accepted', exact: true })).toBeVisible();
  await firstCard.getByRole('button', { name: 'Mark delivered', exact: true }).click();
  await page.getByRole('button', { name: 'My completed work', exact: true }).click();
  await expect(firstCard.getByRole('heading', { name: 'Delivered', exact: true })).toBeVisible();
  await firstCard.getByText('Order history', { exact: true }).click();
  await expect(firstCard).toContainText('Order accepted');
  await expect(firstCard).toContainText('Order delivered');
  await page.getByRole('button', { name: 'Pending', exact: true }).click();
  await secondCard.getByRole('button', { name: 'Accept order', exact: true }).click();
  await expect(secondCard).toHaveCount(0);
  const personal = await page.request.get('/api/orders');
  expect(ordersResponseSchema.parse(await personal.json()).orders).toEqual([]);
  await signOut(page);
  await signIn(page, 'office_admin', adminPassword);
  await page.goto('/work');
  await expect(page.getByRole('heading', { name: 'All office orders', exact: true })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('ACCEPTED');
  await expect(secondCard.getByRole('heading', { name: 'Accepted', exact: true })).toBeVisible();
  await secondCard.locator('summary').filter({ hasText: 'Return to pending' }).click();
  await secondCard.getByRole('form', { name: 'Return to pending', exact: true }).getByLabel('Reason (required)', { exact: false }).fill('অন্য কর্মী প্রয়োজন');
  await secondCard.getByRole('button', { name: 'Return to pending', exact: true }).click();
  await expect(secondCard).toHaveCount(0);
  await page.getByLabel('Status', { exact: true }).selectOption('PENDING');
  await expect(secondCard.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
  await expect(secondCard).toContainText('অন্য কর্মী প্রয়োজন');
  await expect(secondCard).toContainText('Unassigned');
  const requeued = await page.request.get('/api/orders/' + second.id);
  const order = orderResponseSchema.parse(await requeued.json()).order;
  expect(order.assignee).toBeNull();
  expect(order.audit.map((entry) => entry.action)).toEqual(['create', 'accept', 'requeue']);
  expect(order.audit[1].assignee).not.toBeNull();
  await signOut(page);
  await signIn(page, employee, personalPassword);
  await page.goto('/orders');
  await expect(secondCard.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
  await expect(secondCard).toContainText('অন্য কর্মী প্রয়োজন');
  await secondCard.getByText('Order history', { exact: true }).click();
  await expect(secondCard).toContainText('Returned to pending');
  await expect(firstCard.getByRole('heading', { name: 'Delivered', exact: true })).toBeVisible();
});
