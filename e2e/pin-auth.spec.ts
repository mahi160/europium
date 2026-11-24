import { test, expect } from './test';

const headers = { Origin: 'http://localhost:5183' };
const password = 'browser-admin-password-123';

for (const role of ['employee', 'staff']) {
  test(`${role} creation, reset, first sign-in and account menu use four-digit PINs; admin keeps passwords`, async ({ page }) => {
    const setup = await page.request.get('/api/setup');
    if ((await setup.json()).setupRequired) {
      expect((await page.request.post('/api/setup', { headers, data: {
        name: 'PIN administrator', username: 'office_admin', password,
        setupToken: 'browser-test-setup-token-32-characters', language: 'en', floor: '', desk: '',
      } })).status()).toBe(201);
    }
    await page.goto('/');
    await page.getByLabel('ভাষা').selectOption('en');
    const pin = page.getByLabel(/^PIN or password \*$/);
    await expect(page.getByLabel('Sign in as')).toHaveCount(0);
    await expect(pin).not.toHaveAttribute('inputmode');
    await expect(pin).not.toHaveAttribute('pattern');
    await expect(pin).toHaveAttribute('minlength', '1');
    await expect(pin).toHaveAttribute('maxlength', '128');
    await expect(pin).toHaveAttribute('autocomplete', 'current-password');
    await pin.fill('0007');
    await page.getByRole('button', { name: 'Show PIN or password', exact: true }).click();
    await expect(pin).toHaveAttribute('type', 'text');
    await expect(pin).toHaveValue('0007');
    await page.getByRole('button', { name: 'Hide PIN or password', exact: true }).click();
    await expect(pin).toHaveAttribute('type', 'password');
    await expect(pin).toHaveValue('0007');
    await page.getByLabel('Username', { exact: false }).fill('office_admin');
    await pin.fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Administrator', exact: true }).click();
    await expect(page).toHaveURL('/admin');
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    const username = `pin_${role}_${Date.now()}`;
    await page.getByLabel('Full name').fill(username);
    await page.getByLabel('Username', { exact: false }).fill(username);
    await expect(page.getByLabel(/^PIN \*$/)).toHaveAttribute('pattern', '[0-9]{4}');
    await page.getByLabel('Role', { exact: true }).selectOption('admin');
    await expect(page.getByLabel(/^Password \*$/)).toHaveAttribute('minlength', '12');
    await page.getByLabel('Role', { exact: true }).selectOption(role);
    await page.getByLabel(/^PIN \*$/).fill('0017');
    await page.locator('#person-language').selectOption('en');
    await page.getByRole('button', { name: 'Add person', exact: true }).last().click();
    const person = page.getByRole('button', { name: new RegExp(username) });
    await expect(person).toBeVisible();
    await person.click();
    await page.getByRole('button', { name: 'Reset PIN', exact: true }).click();
    await page.getByLabel('Role', { exact: true }).selectOption('admin');
    await expect(page.getByRole('form', { name: 'Reset PIN', exact: true })).toBeVisible();
    await page.getByLabel('New PIN', { exact: false }).fill('0007');
    await page.getByRole('form', { name: 'Reset PIN', exact: true }).getByRole('button', { name: 'Reset PIN', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Username', { exact: false }).fill(username);
    await page.getByLabel(/^PIN or password \*$/).fill('0007');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose your own PIN', exact: true })).toBeVisible();
    await page.getByLabel('Current PIN', { exact: false }).fill('0007');
    await page.getByLabel('New PIN', { exact: false }).fill('0042');
    await page.getByRole('button', { name: 'Change PIN', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: role === 'staff' ? 'Staff queue' : "Today's refreshments", exact: true })).toBeVisible();
    await page.getByRole('button', { name: username, exact: true }).click();
    await page.getByRole('button', { name: 'Change PIN', exact: true }).click();
    await expect(page.getByLabel(/^Password \*$/)).toHaveCount(0);
    await page.getByLabel('Current PIN', { exact: false }).fill('0042');
    await page.getByLabel('New PIN', { exact: false }).fill('0043');
    await page.getByRole('dialog', { name: 'Change PIN', exact: true }).getByRole('button', { name: 'Change PIN', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Username', { exact: false }).fill(username);
    await page.getByLabel(/^PIN or password \*$/).fill('0043');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: username, exact: true })).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Administrator', exact: true })).toHaveCount(0);
  });
}
