import { test, expect } from '../e2e/test';
import { ordersResponseSchema } from '@office-service/shared';
import { type Page } from '@playwright/test';

const headers = { Origin: 'http://localhost:5195' };
const password = 'simple-browser-admin-password-123';

async function admin(page: Page) {
  const setup = await page.request.get('/api/setup');
  if ((await setup.json()).setupRequired) {
    expect((await page.request.post('/api/setup', { headers, data: {
      name: 'Office admin', username: 'simple_admin', password,
      setupToken: 'ui-browser-setup-token-32-characters', language: 'en', floor: '', desk: '',
    } })).status()).toBe(201);
  }
  expect((await page.request.post('/api/auth/login', { headers, data: { username: 'simple_admin', password } })).ok()).toBe(true);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Administrator', exact: true })).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
}

for (const width of [1440, 768, 390]) {
  test(`two simple pages: manage, order, accept and finish at ${width}px`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await admin(page);
    await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Profile', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Manage menu', exact: true })).toBeVisible();
    for (const role of ['employee', 'staff']) {
      await page.getByRole('button', { name: 'Add person', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
      await dialog.getByLabel('Full name', { exact: false }).fill(`${role} ${width}`);
      await dialog.getByLabel('Username', { exact: false }).fill(`simple_${role}_${width}`);
      await dialog.getByLabel('Role', { exact: true }).selectOption(role);
      await dialog.getByLabel('Language', { exact: true }).selectOption('en');
      await dialog.getByLabel('Floor', { exact: false }).fill('3');
      await dialog.getByLabel('Desk', { exact: false }).fill('D12');
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Add refreshment', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Add refreshment', exact: true });
    await menu.getByLabel('Refreshment name', { exact: false }).fill(`Office tea ${width}`);
    await menu.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/simple/admin-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Order refreshments', exact: true }).click();
    await expect(page).toHaveURL('/');

    async function colleague(role: string) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const p = await context.newPage();
      p.on('pageerror', (error) => errors.push(error.message));
      await p.goto('/');
      await p.getByLabel('ভাষা', { exact: true }).selectOption('en');
      await p.getByLabel('Username', { exact: false }).fill(`simple_${role}_${width}`);
      await p.getByLabel(/^PIN or password \*$/).fill('0000');
      await p.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(p.getByRole('heading', { level: 1, name: 'Choose your own PIN', exact: true })).toBeVisible();
      await p.getByLabel('Current PIN', { exact: false }).fill('0000');
      await p.getByLabel('New PIN', { exact: false }).fill('0042');
      await p.getByRole('button', { name: 'Change PIN', exact: true }).click();
      return { p, context };
    }
    const employee = await colleague('employee');
    const p = employee.p;
    await expect(p.getByRole('heading', { level: 1, name: "Today's refreshments", exact: true })).toBeVisible();
    await expect(p.getByRole('navigation')).toHaveCount(0);
    await p.goto('/admin');
    await expect(p.getByText('This section is for authorized staff only.', { exact: true })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Add person', exact: true })).toHaveCount(0);
    await p.goto('/');
    await p.getByRole('button', { name: `Office tea ${width}`, exact: true }).click();
    await p.getByRole('button', { name: 'Note (optional)', exact: true }).click();
    await p.getByLabel('Note (optional)', { exact: false }).fill('No sugar');
    await p.getByRole('button', { name: 'Send order (1)', exact: true }).click();
    await expect(p.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
    const placed = p.getByRole('article').filter({ hasText: `Office tea ${width}` });
    await expect(placed).toContainText('Pending');
    await expect(placed.getByRole('button', { name: 'Cancel order', exact: true })).toBeVisible();
    await expect(p).toHaveURL('/');
    await noOverflow(p);
    await p.screenshot({ path: `test-results/simple/order-${width}.png`, fullPage: true });

    const staff = await colleague('staff');
    await expect(staff.p.getByRole('heading', { level: 1, name: 'Staff queue', exact: true })).toBeVisible();
    await expect(staff.p.getByRole('tab')).toHaveCount(0);
    const order = staff.p.getByRole('article').filter({ hasText: `Office tea ${width}` });
    await expect(order).toContainText(`employee ${width}`);
    await expect(order).toContainText('Floor 3, Desk D12');
    await expect(order).toContainText('No sugar');
    await order.getByRole('button', { name: 'Accept order', exact: true }).click();
    await expect(order).toContainText('Accepted');
    await expect(placed).toContainText('Accepted');
    await noOverflow(staff.p);
    await staff.p.screenshot({ path: `test-results/simple/staff-${width}.png`, fullPage: true });
    await order.getByRole('button', { name: 'Mark delivered', exact: true }).click();
    await expect(order).toHaveCount(0);
    await expect(placed).toContainText('Delivered');
    expect(errors).toEqual([]);
    await employee.context.close();
    await staff.context.close();
  });
}

test('simple order form safely retries a lost response after reload', async ({ page }) => {
  await admin(page);
  const created = await page.request.post('/api/menu', { headers, data: { name: 'Retry tea', category: 'tea', unit: 'কাপ', available: true, archived: false } });
  expect(created.status()).toBe(201);
  await page.goto('/');
  const before = ordersResponseSchema.parse(await (await page.request.get('/api/orders')).json());
  const known = new Set(before.orders.map((order) => order.id));
  let id = '';
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    id = (await response.json()).order.id;
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Retry tea', exact: true }).click();
  await page.getByRole('button', { name: 'Send order (1)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the office server');
  await expect(page.getByRole('button', { name: 'Retry tea', exact: true })).toBeDisabled();
  await page.unroute('**/api/orders');
  await page.reload();
  await page.getByRole('button', { name: 'Retry same order', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
  const result = ordersResponseSchema.parse(await (await page.request.get('/api/orders')).json());
  expect(result.orders.filter((order) => !known.has(order.id)).map((order) => order.id)).toEqual([id]);
});
