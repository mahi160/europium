import { test, expect } from '../e2e/test';
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
  await expect(page.getByRole('heading', { name: 'Administrator', exact: true })).toBeVisible();
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
}

for (const width of [1440, 768, 390, 320]) {
  test(`kiosk: real menu, bilingual draft, order and staff delivery at ${width}px`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await admin(page);
    await fits(page);
    // Create through the real admin dialogs so the management workflows stay covered.
    for (const role of ['employee', 'staff']) {
      await page.getByRole('button', { name: 'Add person', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
      await dialog.getByLabel('Full name', { exact: false }).fill(`Kiosk ${role} ${width}`);
      await dialog.getByLabel('Username', { exact: false }).fill(`kiosk_${role}_${width}`);
      await dialog.getByLabel('Role', { exact: true }).selectOption(role);
      await dialog.getByLabel('Language', { exact: true }).selectOption('en');
      await dialog.getByLabel('Floor', { exact: false }).fill('3');
      await dialog.getByLabel('Desk', { exact: false }).fill('D12');
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    const name = `Kiosk tea ${width}`;
    await page.getByRole('button', { name: 'Add refreshment', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Add refreshment', exact: true });
    await menu.getByLabel('Refreshment name', { exact: false }).fill(name);
    await menu.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await fits(page);
    await page.screenshot({ path: `test-results/kiosk/admin-${width}.png`, fullPage: true, animations: 'disabled' });
    for (const [item, available, archived] of [['Unavailable tea', false, false], ['Archived tea', true, true]] as const) {
      expect((await page.request.post('/api/menu', { headers, data: {
        name: `${item} ${width}`, category: 'tea', unit: 'কাপ', available, archived,
      } })).status()).toBe(201);
    }

    async function colleague(role: string) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const p = await context.newPage();
      p.on('pageerror', error => errors.push(error.message));
      await p.goto('/');
      await p.getByLabel('ভাষা', { exact: true }).selectOption('en');
      await p.getByLabel('Username', { exact: false }).fill(`kiosk_${role}_${width}`);
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
    await expect(p.getByRole('heading', { level: 1, name: "Today's refreshments" })).toBeVisible();
    await expect(p.getByRole('navigation')).toHaveCount(0);
    await expect(p.getByRole('button', { name: `Archived tea ${width}`, exact: true })).toHaveCount(0);
    await expect(p.getByRole('button', { name: `Unavailable tea ${width}`, exact: false })).toBeDisabled();
    await p.getByRole('button', { name, exact: true }).click();
    await expect(p.getByRole('button', { name: 'Send order (1)', exact: true })).toBeEnabled();
    await p.getByRole('button', { name, exact: true }).click();
    await p.getByRole('button', { name: `Decrease ${name}`, exact: true }).click();
    await p.getByRole('button', { name: `Increase ${name}`, exact: true }).click();
    await expect(p.getByLabel('Note (optional)', { exact: false })).toBeHidden();
    await p.getByRole('button', { name: 'Note (optional)', exact: true }).click();
    await p.getByLabel('Note (optional)', { exact: false }).fill('No sugar');
    await p.reload();
    await expect(p.getByLabel('Note (optional)', { exact: false })).toHaveValue('No sugar');
    await expect(p.getByRole('button', { name: 'Send order (2)', exact: true })).toBeEnabled();
    await p.getByLabel('Language', { exact: true }).selectOption('bn');
    await expect(p.getByRole('heading', { level: 1, name: 'আজকের চা-নাস্তা' })).toBeVisible();
    await expect(p.getByRole('button', { name: 'অর্ডার পাঠান (২)', exact: true })).toBeEnabled();
    await expect(p.locator('.kiosk-delivery')).toContainText('D১২');
    await expect(p.locator('.kiosk-delivery')).not.toContainText(/[0-9]/);
    await fits(p);
    await p.screenshot({ path: `test-results/kiosk/bangla-${width}.png`, fullPage: true, animations: 'disabled' });
    await p.getByLabel('ভাষা', { exact: true }).selectOption('en');
    await fits(p);
    await p.screenshot({ path: `test-results/kiosk/english-${width}.png`, fullPage: true, animations: 'disabled' });
    await p.getByRole('button', { name: 'Send order (2)', exact: true }).click();
    await expect(p.getByRole('status').filter({ hasText: 'Order placed. Your refreshments are on the list.' })).toBeVisible();
    const placed = p.getByRole('article').filter({ hasText: name });
    await expect(placed).toContainText('Pending');
    await expect(placed).toContainText('2 কাপ');

    const staff = await colleague('staff');
    await expect(staff.p.getByRole('heading', { name: 'Staff queue', exact: true })).toBeVisible();
    const order = staff.p.getByRole('article').filter({ hasText: name });
    await expect(order).toContainText(`Kiosk employee ${width}`);
    await expect(order).toContainText('Floor 3, Desk D12');
    await expect(order).toContainText('No sugar');
    await order.getByRole('button', { name: 'Accept order', exact: true }).click();
    await expect(placed).toContainText('Accepted');
    await fits(staff.p);
    await staff.p.screenshot({ path: `test-results/kiosk/staff-${width}.png`, fullPage: true, animations: 'disabled' });
    await order.getByRole('button', { name: 'Mark delivered', exact: true }).click();
    await expect(order).toHaveCount(0);
    await expect(placed).toContainText('Delivered');
    await expect(p.getByRole('status').filter({ hasText: 'Order placed.' })).toHaveCount(0);
    await p.getByLabel('Language', { exact: true }).selectOption('bn');
    await expect(placed.locator('time')).toContainText(/[০-৯]/);
    await expect(placed.locator('time')).not.toContainText(/[0-9]|AM|PM/);
    await p.getByLabel('ভাষা', { exact: true }).selectOption('en');
    await p.goto('/admin');
    await expect(p.getByText('This section is for authorized staff only.', { exact: true })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Add person', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    await employee.context.close();
    await staff.context.close();
  });
}

test('kiosk preserves frozen payload and retries a lost response exactly once', async ({ page }) => {
  await admin(page);
  const name = 'Kiosk retry tea';
  const created = await page.request.post('/api/menu', { headers, data: { name, category: 'tea', unit: 'কাপ', available: true, archived: false } });
  expect(created.status()).toBe(201);
  const itemId = (await created.json()).item.id;
  await page.goto('/');
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Note (optional)', exact: true }).click();
  await page.getByLabel('Note (optional)', { exact: false }).fill('Frozen note');
  let id = '';
  await page.route('**/api/orders', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    id = (await response.json()).order.id;
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Send order (1)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the office server');
  await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(page.getByLabel('Note (optional)', { exact: false })).toBeDisabled();
  await expect(page.getByRole('button', { name: `Decrease ${name}`, exact: true })).toBeDisabled();
  await page.unroute('**/api/orders');
  await page.reload();
  await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(page.getByLabel('Note (optional)', { exact: false })).toHaveValue('Frozen note');
  await page.getByRole('button', { name: 'Retry same order', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order placed. Your refreshments are on the list.' })).toBeVisible();
  const result = await (await page.request.get('/api/orders')).json();
  const matching = result.orders.filter((order: { items: { itemId: string }[] }) => order.items.some(item => item.itemId === itemId));
  expect(matching).toHaveLength(1);
  expect(matching[0].id).toBe(id);
  await expect(page.getByRole('button', { name: 'Send order (0)', exact: true })).toBeDisabled();
});
