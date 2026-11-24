import { expect, test, type Page } from '@playwright/test';

const adminPassword = 'ui-browser-admin-password-123';
const headers = { Origin: 'http://localhost:5195' };

async function go(page: Page, name: string) {
  const link = page.getByRole('link', { name, exact: true });
  if (!await link.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await link.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/ui-after/${name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 768, 390]) {
  test(`simple, accessible employee/admin/staff flows at ${width}px`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const setup = await page.request.get('/api/setup');
    await page.goto('/');
    await page.getByLabel('ভাষা', { exact: true }).selectOption('en');
    if ((await setup.json()).setupRequired) {
      await page.getByLabel('Setup token', { exact: false }).fill('ui-browser-setup-token-32-characters');
      await page.getByLabel('Full name', { exact: false }).fill('Office administrator');
      await page.getByLabel('Username', { exact: false }).fill('ui_admin');
      await page.getByLabel('Password', { exact: false }).fill(adminPassword);
      await page.getByRole('button', { name: 'Set up Office Service', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true, level: 1 })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toHaveCount(0);
    }
    await page.getByLabel('Sign in as').selectOption('admin');
    await page.getByLabel('Username', { exact: false }).fill('ui_admin');
    await page.getByLabel('Password', { exact: false }).fill(adminPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Staff queue', exact: true })).toBeVisible();
    await go(page, 'People');
    for (const role of ['employee', 'staff']) {
      await page.getByRole('button', { name: 'Add person', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Full name', { exact: false }).fill(`${role === 'employee' ? 'Rahim' : 'Karim'} ${width}`);
      await dialog.getByLabel('Username', { exact: false }).fill(`ui_${role}_${width}`);
      await dialog.getByLabel('Role', { exact: true }).selectOption(role);
      await dialog.getByRole('textbox', { name: /^PIN/ }).fill('0017');
      await dialog.getByLabel('Language', { exact: true }).selectOption('en');
      await dialog.getByLabel('Floor', { exact: false }).fill('3');
      await dialog.getByLabel('Desk', { exact: false }).fill('D12');
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    await page.getByLabel('Search people').fill(`Rahim ${width}`);
    const person = page.getByRole('button', { name: new RegExp(`Rahim ${width}`) });
    await person.focus();
    await page.keyboard.press('Enter');
    const edit = page.getByRole('dialog', { name: 'Edit person', exact: true });
    await expect(edit).toBeVisible();
    await expect(edit.getByLabel('Full name', { exact: false })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(edit.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => edit.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await shot(page, `people-dialog-${width}`);
    await page.keyboard.press('Escape');
    await expect(edit).toHaveCount(0);
    await expect(person).toBeFocused();
    await person.click();
    await edit.getByLabel('Role', { exact: true }).selectOption('admin');
    await expect(edit).toContainText('clears their sign-in credential');
    await edit.getByText('Reset PIN', { exact: true }).first().click();
    await edit.getByLabel('New PIN', { exact: false }).fill('0027');
    await edit.getByRole('button', { name: 'Reset PIN', exact: true }).click();
    await expect(edit.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Search people').fill('');
    await shot(page, `people-${width}`);

    await go(page, 'Manage menu');
    await page.getByRole('button', { name: 'Add refreshment', exact: true }).click();
    const menuDialog = page.getByRole('dialog', { name: 'Add refreshment', exact: true });
    await menuDialog.getByLabel('Refreshment name', { exact: false }).fill(`Audit water ${width}`);
    await menuDialog.getByLabel('Category', { exact: true }).selectOption('water');
    await menuDialog.getByLabel('Bangla unit', { exact: false }).fill('গ্লাস');
    await menuDialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(menuDialog).toHaveCount(0);
    const menuRow = page.getByRole('button', { name: new RegExp(`Audit water ${width}`) });
    await menuRow.click();
    const menuEdit = page.getByRole('dialog', { name: 'Edit refreshment', exact: true });
    await menuEdit.getByLabel('Archive refreshment').check();
    await menuEdit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(menuRow).toContainText('Archived');
    await shot(page, `menu-${width}`);

    async function signIn(role: string, pin: string) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
      const p = await context.newPage();
      p.on('pageerror', (error) => errors.push(error.message));
      await p.goto('/');
      await p.getByLabel('ভাষা', { exact: true }).selectOption('en');
      await p.getByLabel('Username', { exact: false }).fill(`ui_${role}_${width}`);
      await p.getByRole('textbox', { name: /^PIN/ }).fill(pin);
      await p.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(p.getByRole('heading', { name: 'Choose your own PIN', exact: true, level: 1 })).toBeVisible();
      await p.getByLabel('Current PIN', { exact: false }).fill(pin);
      await p.getByLabel('New PIN', { exact: false }).fill('0042');
      await p.getByRole('button', { name: 'Change PIN', exact: true }).click();
      return { p, context };
    }
    const employee = await signIn('employee', '0027');
    const p = employee.p;
    await expect(p.getByRole('heading', { name: 'Order refreshments', exact: true, level: 1 })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Place order', exact: true })).toHaveCount(0);
    await p.getByRole('button', { name: 'Increase পানি', exact: true }).click();
    const submit = p.getByRole('button', { name: 'Place order', exact: true });
    const bounds = await submit.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) { expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThan(width === 390 ? 844 : 1000); }
    await p.getByText('Add instructions', { exact: true }).click();
    await expect(p.getByRole('group', { name: 'Quick instructions', exact: true })).toHaveCount(0);
    await p.getByRole('button', { name: 'Remove পানি', exact: true }).click();
    await p.getByRole('button', { name: 'Increase দুধ চা', exact: true }).click();
    await p.getByText('Add instructions', { exact: true }).click();
    await p.getByRole('button', { name: 'চিনি', exact: true }).click();
    await p.getByRole('button', { name: 'চিনি ছাড়া', exact: true }).click();
    await expect(p.getByRole('button', { name: 'চিনি', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(p.getByLabel('Note (optional)', { exact: false })).toHaveValue('চিনি ছাড়া');
    await p.reload();
    await expect(p.getByLabel('Note (optional)', { exact: false })).toHaveValue('চিনি ছাড়া');
    await shot(p, `ordering-${width}`);
    await submit.click();
    await expect(p.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
    await expect(p.locator('.order-confirmation')).toBeFocused();
    await expect(p.getByRole('article').getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
    await shot(p, `placed-${width}`);

    const staff = await signIn('staff', '0017');
    await expect(staff.p.getByRole('heading', { name: 'Staff queue', level: 1, exact: true })).toBeVisible();
    await expect(staff.p.getByRole('article')).toContainText(`Rahim ${width}`);
    await expect(staff.p.getByRole('tab', { name: /^Done/ })).toBeVisible();
    await shot(staff.p, `queue-${width}`);
    await staff.p.getByRole('button', { name: 'Accept order', exact: true }).click();
    await expect(staff.p.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');
    await expect(staff.p.getByRole('button', { name: 'Mark delivered', exact: true })).toBeVisible();
    await expect(staff.p.getByRole('status').filter({ hasText: 'Order accepted.' })).toBeVisible();
    await shot(staff.p, `accepted-${width}`);
    await staff.p.getByRole('button', { name: 'Mark delivered', exact: true }).click();
    await expect(staff.p.getByRole('tab', { name: /^Pending/ })).toHaveAttribute('aria-selected', 'true');
    await expect(staff.p.getByRole('status').filter({ hasText: 'Order delivered.' })).toBeVisible();
    await staff.p.getByRole('tab', { name: /^Pending/ }).focus();
    await staff.p.keyboard.press('ArrowRight');
    await expect(staff.p.getByRole('tab', { name: /^Active/ })).toBeFocused();
    await expect(staff.p.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');

    await go(p, 'My orders');
    await expect(p.getByRole('heading', { name: 'Delivered', exact: true })).toBeVisible();
    await go(p, 'Order refreshments');
    await p.getByRole('button', { name: 'Increase পানি', exact: true }).click();
    await submit.click();
    await expect(p.getByRole('article').getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'Cancel order', exact: true }).click();
    const cancel = p.getByRole('dialog', { name: 'Cancel order', exact: true });
    await cancel.getByLabel('Cancellation reason', { exact: false }).fill('Meeting ended');
    await cancel.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(cancel).toHaveCount(0);
    await expect(p.getByRole('heading', { name: 'Cancelled', exact: true })).toBeVisible();

    await go(p, 'Profile');
    const profileLanguage = p.getByLabel('Language', { exact: true });
    if (await profileLanguage.isVisible()) await profileLanguage.selectOption('bn');
    else {
      await p.getByRole('button', { name: 'Menu', exact: true }).click();
      await p.getByRole('dialog').getByLabel('Language', { exact: true }).selectOption('bn');
      await p.getByRole('button', { name: 'বন্ধ করুন', exact: true }).click();
    }
    await expect(p.locator('html')).toHaveAttribute('lang', 'bn-BD');
    await expect(p.getByRole('heading', { name: 'প্রোফাইল', exact: true, level: 1 })).toBeVisible();
    await shot(p, `profile-bn-${width}`);
    expect(errors).toEqual([]);
    await employee.context.close();
    await staff.context.close();
  });
}

test('lost order responses retain a locked draft and retry without duplicates', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { headers, data: { username: 'ui_admin', password: adminPassword } });
  expect(login.ok()).toBe(true);
  await page.goto('/order');
  await expect(page.getByRole('heading', { name: 'Order refreshments', level: 1, exact: true })).toBeVisible();
  let id = '';
  await page.route('**/api/orders', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    id = (await response.json()).order.id;
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Increase পানি', exact: true }).click();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the office server');
  await expect(page.getByRole('button', { name: 'Increase পানি', exact: true })).toBeDisabled();
  await page.unroute('**/api/orders');
  await page.reload();
  await page.getByRole('button', { name: 'Retry same order', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
  const response = await page.request.get('/api/orders');
  const result = await response.json();
  expect(result.orders).toHaveLength(1);
  expect(result.orders[0].id).toBe(id);
});

for (const width of [1440, 390]) {
  test(`remove a person requires confirmation and persists at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const login = await page.request.post('/api/auth/login', { headers, data: { username: 'ui_admin', password: adminPassword } });
    expect(login.ok()).toBe(true);
    const name = `Remove person ${width}`;
    const created = await page.request.post('/api/users', { headers, data: {
      username: `remove_person_${width}`, name, password: '0017', role: 'employee', language: 'en', floor: '', desk: '',
    } });
    expect(created.status()).toBe(201);
    const { user } = await created.json();
    await page.goto('/users');
    const row = page.getByRole('button', { name: new RegExp(name) });
    await row.click();
    await page.getByRole('dialog', { name: 'Edit person', exact: true }).getByRole('button', { name: 'Remove person', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Remove person', exact: true });
    await expect(confirmation).toContainText(name);
    await expect(confirmation).toContainText('Their orders and history will be kept.');
    await expect(confirmation.getByRole('button', { name: 'Confirm removal', exact: true })).not.toBeFocused();
    await confirmation.getByRole('button', { name: 'Keep person', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit person', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole('button', { name: 'Remove person', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: `${name} removed. Order history kept.` })).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(row).toHaveCount(0);
    const reactivate = await page.request.patch(`/api/users/${user.id}`, { headers, data: { isActive: true } });
    expect(reactivate.status()).toBe(404);
  });
}
