import { randomUUID } from 'node:crypto';
import { test, expect } from './test';
import { type Browser, type Page } from '@playwright/test';
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
    async function addPerson(role: 'employee' | 'staff', client: Page, suffix = '') {
      const username = 'cancel_' + role + '_' + unique + suffix;
      const response = await page.request.post('/api/users', { headers, data: {
        name: username, username, password: temporaryPassword, role, language: 'en', floor: '3', desk: unique,
      } });
      expect(response.status()).toBe(201);
      await signIn(client, username, temporaryPassword);
      expect((await client.request.post('/api/auth/change-password', { headers, data: { currentPassword: temporaryPassword, newPassword: personalPassword } })).ok()).toBe(true);
    }
    await addPerson('employee', employee);
    await addPerson('staff', staff);
    await Promise.all([employee.goto('/'), staff.goto('/')]);
    await Promise.all([expect(employee.locator('[data-realtime="current"]')).toBeVisible(), expect(staff.locator('[data-realtime="current"]')).toBeVisible()]);
    return { employee, staff, name, contexts, addPerson, close: async () => { for (const context of contexts) await context.close(); } };
  } catch (error) {
    for (const context of contexts) await context.close();
    throw error;
  }
}

async function placeOrder({ employee, staff, name }: Awaited<ReturnType<typeof office>>) {
  await employee.getByRole('group', { name: 'Choose a refreshment' }).getByRole('button', { name, exact: true }).click();
  await employee.getByRole('button', { name: 'Send order (1)', exact: true }).click();
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
    await expect(staffCard.getByRole('button', { name: 'Reject order', exact: true })).toHaveCount(0);
  } finally { await f.close(); }
});

test('a delivered order can be sent again in one tap', async ({ page, browser }) => {
  const f = await office(page, browser);
  try {
    const reorder = f.employee.getByRole('button', { name: 'Same as last time: ' + f.name + ' ×1', exact: true });
    await expect(reorder).toHaveCount(0);
    const { employeeCard, accept, staffCard } = await placeOrder(f);
    await accept.click();
    await staffCard.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(employeeCard.getByText('Delivered', { exact: true })).toBeVisible();
    await reorder.click();
    await expect(employeeCard).toHaveCount(2);
    await expect(employeeCard.getByText('Pending', { exact: true })).toBeVisible();
    await expect(staffCard.getByText('Pending', { exact: true })).toBeVisible();
  } finally { await f.close(); }
});

test('a confirmed order action updates the card while list refresh is still pending', async ({ page, browser }) => {
  const f = await office(page, browser);
  let release = () => {};
  try {
    const { accept, staffCard } = await placeOrder(f);
    const held = new Promise<void>((resolve) => { release = resolve; });
    await f.staff.route('**/api/work/orders', async (route) => { await held; await route.continue(); });
    const refetch = f.staff.waitForRequest('**/api/work/orders');
    await accept.click();
    await refetch;
    await expect(staffCard.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(staffCard.getByRole('button', { name: 'Mark delivered' })).toBeEnabled();
  } finally { release(); await f.close(); }
});

test('admin observes live while assigned staff returns an order for another staff member to deliver', async ({ page, browser }) => {
  const f = await office(page, browser);
  const otherContext = await browser.newContext();
  try {
    const second = await otherContext.newPage();
    await f.addPerson('staff', second, '_2');
    await Promise.all([page.goto('/admin'), second.goto('/')]);
    const admin = page.getByRole('region', { name: 'Active orders' });
    const adminCard = admin.getByRole('article').filter({ hasText: f.name });
    const secondCard = second.getByRole('article').filter({ hasText: f.name });
    const { employeeCard, accept, staffCard } = await placeOrder(f);
    await expect(adminCard.getByText('Pending', { exact: true })).toBeVisible();
    await expect(adminCard.getByRole('button')).toHaveCount(0);
    await accept.click();
    await expect(adminCard.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(adminCard.getByRole('button')).toHaveCount(0);
    await expect(secondCard).toHaveCount(0);
    await staffCard.getByRole('button', { name: 'Return to pending' }).click();
    const dialog = f.staff.getByRole('dialog', { name: 'Return to pending' });
    await dialog.getByLabel('Reason (optional)').fill('My shift has ended.');
    await dialog.getByRole('button', { name: 'Return to pending' }).click();
    await expect(employeeCard).toContainText('My shift has ended.');
    await expect(adminCard.getByText('Pending', { exact: true })).toBeVisible();
    await secondCard.getByRole('button', { name: 'Accept order' }).click();
    await secondCard.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(employeeCard.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(adminCard).toHaveCount(0);
  } finally { await otherContext.close(); await f.close(); }
});

test('staff rejects a pending order with a reason visible to the employee', async ({ page, browser }) => {
  const f = await office(page, browser);
  try {
    const { employeeCard, staffCard } = await placeOrder(f);
    const reject = staffCard.getByRole('button', { name: 'Reject order', exact: true });
    const dialog = f.staff.getByRole('dialog', { name: 'Reject order' });
    const reason = dialog.getByLabel('Reason (required)', { exact: false });
    await reject.focus();
    await reject.press('Enter');
    await expect(reason).toBeFocused();
    await reason.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(reject).toBeFocused();
    await reject.click();
    await reason.fill('   ');
    const submit = dialog.getByRole('button', { name: 'Reject order', exact: true });
    await submit.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(employeeCard.getByText('Pending', { exact: true })).toBeVisible();
    await reason.fill('The kitchen is closed.');
    await submit.click();
    await expect(staffCard).toHaveCount(0);
    await expect(employeeCard.getByText('Rejected', { exact: true })).toBeVisible();
    await expect(employeeCard).toContainText('The kitchen is closed.');
  } finally { await f.close(); }
});
