import { randomUUID } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { z } from 'zod';
import { setupSchema } from '@office-service/shared';

const headers = { Origin: 'http://localhost:5183' };
const adminPassword = 'browser-admin-password-123';
const temporaryPassword = '0007';
const personalPassword = '0042';

async function signIn(page: Page, username: string, password: string) {
  expect((await page.request.post('/api/auth/login', { headers, data: { username, password } })).ok()).toBe(true);
}

async function office(page: Page, browser: Browser) {
  const setup = z.object({ setupRequired: z.boolean() }).parse(await (await page.request.get('/api/setup')).json());
  if (setup.setupRequired) {
    expect((await page.request.post('/api/setup', { headers, data: setupSchema.parse({
      setupToken: 'browser-test-setup-token-32-characters', username: 'office_admin', password: adminPassword,
      name: 'Office administrator', language: 'en', floor: '', desk: '',
    }) })).status()).toBe(201);
  }
  await signIn(page, 'office_admin', adminPassword);
  const unique = randomUUID().replaceAll('-', '').slice(0, 12);
  const name = 'Cancellation tea ' + unique;
  expect((await page.request.post('/api/menu', { headers, data: {
    name, category: 'tea', unit: 'কাপ', available: true, archived: false,
  } })).status()).toBe(201);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const employee = await contexts[0].newPage();
    const staff = await contexts[1].newPage();
    for (const [role, client] of [['employee', employee], ['staff', staff]] as const) {
      const username = 'cancel_' + role + '_' + unique;
      const response = await page.request.post('/api/users', { headers, data: {
        name: username, username, password: temporaryPassword, role, language: 'en', floor: '3', desk: unique,
      } });
      expect(response.status()).toBe(201);
      await signIn(client, username, temporaryPassword);
      expect((await client.request.post('/api/auth/change-password', { headers, data: { currentPassword: temporaryPassword, newPassword: personalPassword } })).ok()).toBe(true);
    }
    await Promise.all([employee.goto('/'), staff.goto('/')]);
    await Promise.all([expect(employee.locator('[data-realtime="current"]')).toBeVisible(), expect(staff.locator('[data-realtime="current"]')).toBeVisible()]);
    return { employee, staff, name, contexts, close: async () => { for (const context of contexts) await context.close(); } };
  } catch (error) {
    for (const context of contexts) await context.close();
    throw error;
  }
}

async function placeOrder({ employee, staff, name }: Awaited<ReturnType<typeof office>>) {
  await employee.getByRole('group', { name: 'Choose a refreshment' }).getByRole('button', { name, exact: true }).click();
  await employee.getByRole('button', { name: 'Add 1 to your order', exact: true }).click();
  await employee.getByRole('button', { name: 'Place order', exact: true }).click();
  const employeeCard = employee.getByRole('article').filter({ hasText: name });
  const staffCard = staff.getByRole('article').filter({ hasText: name });
  const accept = staffCard.getByRole('button', { name: 'Accept order', exact: true });
  await expect(employeeCard.getByText('Pending', { exact: true })).toBeVisible();
  await expect(accept).toBeVisible();
  await expect(staffCard.getByRole('button', { name: 'Cancel order', exact: true })).toHaveCount(0);
  const cancel = employeeCard.getByRole('button', { name: 'Cancel order', exact: true });
  return { employeeCard, staffCard, accept, cancel };
}

test('employee cancels a pending order and the staff queue updates live', async ({ page, browser }) => {
  const f = await office(page, browser);
  try {
    const { employeeCard, staffCard, cancel } = await placeOrder(f);
    await expect(cancel).toBeEnabled();
    await f.contexts[0].setOffline(true);
    await expect(cancel).toBeDisabled();
    await f.contexts[0].setOffline(false);
    await cancel.click();
    await expect(employeeCard.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(cancel).toHaveCount(0);
    await expect(staffCard).toHaveCount(0);
  } finally { await f.close(); }
});

test('an order accepted before cancellation shows its real status and a conflict message', async ({ page, browser }) => {
  const f = await office(page, browser);
  try {
    const { employeeCard, staffCard, accept, cancel } = await placeOrder(f);
    await f.employee.route('**/api/orders/*/cancel', async (route) => {
      await accept.click();
      await expect(staffCard.getByText('Accepted', { exact: true })).toBeVisible();
      await route.continue();
    });
    await cancel.click();
    await expect(employeeCard.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(cancel).toHaveCount(0);
    await expect(f.employee.getByRole('alert')).toContainText('Only pending orders can be cancelled.');
  } finally { await f.close(); }
});
