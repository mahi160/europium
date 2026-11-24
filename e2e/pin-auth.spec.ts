import { test, expect } from '@playwright/test';

const headers = { Origin: 'http://localhost:5183' };
const password = 'pin-browser-admin-password-123';

for (const role of ['employee', 'staff']) {
  test(`${role} creation, reset, first sign-in and profile use four-digit PINs; admin keeps passwords`, async ({ page }) => {
    const setup = await page.request.get('/api/setup');
    if ((await setup.json()).setupRequired) {
      expect((await page.request.post('/api/setup', { headers, data: {
        name: 'PIN administrator', username: 'pin_admin', password,
        setupToken: 'browser-test-setup-token-32-characters', language: 'en', floor: '', desk: '',
      } })).status()).toBe(201);
    }
    await page.goto('/');
    await page.getByLabel('ভাষা').selectOption('en');
    const pin = page.getByLabel('PIN', { exact: false });
    await expect(pin).toHaveAttribute('inputmode', 'numeric');
    await expect(pin).toHaveAttribute('maxlength', '4');
    await expect(pin).toHaveAttribute('autocomplete', 'current-password');
    await pin.fill('0007');
    await page.getByRole('button', { name: 'Show PIN', exact: true }).click();
    await expect(pin).toHaveAttribute('type', 'text');
    await expect(pin).toHaveValue('0007');
    await page.getByLabel('Sign in as').selectOption('admin');
    await expect(page.getByLabel('Password', { exact: false })).toHaveValue('');
    await page.getByLabel('Username', { exact: false }).fill('pin_admin');
    await page.getByLabel('Password', { exact: false }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'People', exact: true }).click();
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    const username = `pin_${role}_${Date.now()}`;
    await page.getByLabel('Full name').fill(username);
    await page.getByLabel('Username', { exact: false }).fill(username);
    await expect(page.getByLabel('PIN', { exact: false })).toHaveAttribute('pattern', '[0-9]{4}');
    await page.getByLabel('Role', { exact: true }).selectOption('admin');
    await expect(page.getByLabel('Password', { exact: false })).toHaveAttribute('minlength', '12');
    await page.getByLabel('Role', { exact: true }).selectOption(role);
    await page.getByLabel('PIN', { exact: false }).fill('0017');
    await page.locator('#person-language').selectOption('en');
    await page.getByRole('button', { name: 'Add person', exact: true }).last().click();
    const person = page.getByRole('button', { name: new RegExp(username) });
    await expect(person).toBeVisible();
    await person.click();
    await expect(page.getByRole('heading', { name: 'Reset PIN', exact: true })).toBeVisible();
    await page.getByLabel('Role', { exact: true }).selectOption('admin');
    await expect(page.getByRole('heading', { name: 'Reset PIN', exact: true })).toBeVisible();
    await page.getByLabel('New PIN', { exact: false }).fill('0007');
    await page.getByRole('button', { name: 'Reset PIN', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Username', { exact: false }).fill(username);
    await page.getByLabel('PIN', { exact: false }).fill('0007');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose your own PIN', exact: true })).toBeVisible();
    await page.getByLabel('Current PIN', { exact: false }).fill('0007');
    await page.getByLabel('New PIN', { exact: false }).fill('0042');
    await page.getByRole('button', { name: 'Change PIN', exact: true }).click();
    await page.getByRole('link', { name: 'Profile', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: false })).toHaveCount(0);
    await page.getByLabel('Current PIN', { exact: false }).fill('0042');
    await page.getByLabel('New PIN', { exact: false }).fill('0043');
    await page.getByRole('button', { name: 'Change PIN', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Username', { exact: false }).fill(username);
    await page.getByLabel('PIN', { exact: false }).fill('0043');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'People', exact: true })).toHaveCount(0);
  });
}
