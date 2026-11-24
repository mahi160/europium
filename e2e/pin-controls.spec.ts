import { test, expect } from './test';
import { type Page } from '@playwright/test';

const headers = { Origin: 'http://localhost:5183' };
const adminPassword = 'browser-admin-password-123';

async function signInAdmin(page: Page) {
  const setup = await page.request.get('/api/setup');
  if ((await setup.json()).setupRequired) {
    expect((await page.request.post('/api/setup', { headers, data: {
      name: 'Office administrator', username: 'office_admin', password: adminPassword,
      setupToken: 'browser-test-setup-token-32-characters', language: 'en', floor: '', desk: '',
    } })).status()).toBe(201);
  }
  expect((await page.request.post('/api/auth/login', { headers, data: { username: 'office_admin', password: adminPassword } })).status()).toBe(200);
}

test('an employee changes their own PIN from the account menu and stays signed in', async ({ page }) => {
  await signInAdmin(page);
  const username = `change_pin_${Date.now()}`;
  const name = 'Voluntary PIN change';
  expect((await page.request.post('/api/users', { headers, data: {
    name, username, password: '0007', role: 'employee', language: 'en', floor: '', desk: '',
  } })).status()).toBe(201);
  expect((await page.request.post('/api/auth/login', { headers, data: { username, password: '0007' } })).status()).toBe(200);
  expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: '0007', newPassword: '0042' } })).status()).toBe(200);
  await page.goto('/');
  await page.getByRole('button', { name, exact: true }).click();
  const change = page.getByRole('button', { name: 'Change PIN', exact: true });
  await change.click();
  const dialog = page.getByRole('dialog', { name: 'Change PIN' });
  const current = dialog.getByLabel('Current PIN', { exact: false });
  const next = dialog.getByLabel('New PIN', { exact: false });
  await expect(next).toHaveAttribute('maxlength', '4');
  await current.fill('9999');
  await next.fill('2468');
  const submit = dialog.getByRole('button', { name: 'Change PIN', exact: true });
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText('The current sign-in credential is incorrect.');
  await current.fill('0042');
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
});

test('first PIN setup explains an unchanged PIN, supports corrections, and presents accessible four-digit fields', async ({ page }) => {
  await signInAdmin(page);
  const username = `pin_controls_${Date.now()}`;
  expect((await page.request.post('/api/users', { headers, data: {
    name: 'PIN control test', username, password: '0007', role: 'employee', language: 'en', floor: '', desk: '',
  } })).status()).toBe(201);
  expect((await page.request.post('/api/auth/logout', { headers, data: {} })).status()).toBe(200);
  expect((await page.request.post('/api/auth/login', { headers, data: { username, password: '0007' } })).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose your own PIN', exact: true })).toBeVisible();
  const current = page.getByLabel('Current PIN', { exact: false });
  const next = page.getByLabel('New PIN', { exact: false });
  await current.fill('0007');
  await next.fill('0007');
  await page.getByRole('button', { name: 'Change PIN', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different from your current');
  await expect(page.getByRole('heading', { name: 'Choose your own PIN', exact: true })).toBeVisible();
  for (const field of [current, next]) {
    await expect(field).toHaveAttribute('inputmode', 'numeric');
    await expect(field).toHaveAttribute('minlength', '4');
    await expect(field).toHaveAttribute('maxlength', '4');
    await expect(field).toHaveAttribute('pattern', '[0-9]{4}');
  }
  await expect(next).toHaveAttribute('autocomplete', 'new-password');
  await next.fill('004');
  await page.getByRole('button', { name: 'Change PIN', exact: true }).click();
  expect(await next.evaluate((input) => input instanceof HTMLInputElement ? input.validationMessage : null)).toBe('Enter exactly 4 digits (0–9).');
  await next.fill('0042');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await next.press('ArrowLeft');
  await next.press('Backspace');
  await expect(next).toHaveValue('002');
  await next.fill('0042');
  await page.getByRole('button', { name: 'Show PIN', exact: true }).last().click();
  await expect(next).toHaveValue('0042');
  await page.getByRole('button', { name: 'Hide PIN', exact: true }).click();
  await expect(next).toHaveAttribute('type', 'password');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/pin-setup-phone.png', fullPage: true });
  await page.getByRole('button', { name: 'Change PIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PIN control test', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Sign in as')).toHaveCount(0);
  await page.getByLabel(/^PIN or password \*$/).fill('0042');
  await page.getByLabel('Username', { exact: false }).fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PIN control test', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/');
});

test('adding employees and staff defaults to 0000, while administrators still need a password', async ({ page }) => {
  await signInAdmin(page);
  await page.goto('/admin');
  for (const role of ['employee', 'staff']) {
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await expect(page.getByLabel(/^PIN \*$/)).toHaveValue('0000');
    await page.getByLabel('Role', { exact: true }).selectOption('admin');
    await expect(page.getByLabel(/^Password \*$/)).toHaveValue('');
    await page.getByLabel('Role', { exact: true }).selectOption(role);
    await expect(page.getByLabel(/^PIN \*$/)).toHaveValue('0000');
    const username = `default_${role}_${Date.now()}`;
    await page.getByLabel('Username', { exact: false }).fill(username);
    await page.getByLabel('Full name').fill(username);
    await page.locator('#person-language').selectOption('en');
    await page.getByRole('button', { name: 'Add person', exact: true }).last().click();
    await expect(page.getByRole('button', { name: new RegExp(username) })).toBeVisible();
    expect((await page.request.post('/api/auth/logout', { headers, data: {} })).status()).toBe(200);
    const login = await page.request.post('/api/auth/login', { headers, data: { username, password: '0000' } });
    expect(login.status()).toBe(200);
    expect((await login.json()).user.mustChangePassword).toBe(true);
    expect((await page.request.post('/api/auth/logout', { headers, data: {} })).status()).toBe(200);
    expect((await page.request.post('/api/auth/login', { headers, data: { username: 'office_admin', password: adminPassword } })).status()).toBe(200);
    await page.goto('/admin');
  }
});
