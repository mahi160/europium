import { expect, test } from '@playwright/test';

const headers = { Origin: 'http://localhost:5195' };
const password = 'simple-browser-admin-password-123';

for (const width of [1440, 768, 390]) {
  test(`four designs keep menu controls and drafts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const setup = await page.request.get('/api/setup');
    if ((await setup.json()).setupRequired) {
      expect((await page.request.post('/api/setup', { headers, data: {
        name: 'Office admin', username: 'simple_admin', password,
        setupToken: 'ui-browser-setup-token-32-characters', language: 'en', floor: '', desk: '',
      } })).status()).toBe(201);
    }
    expect((await page.request.post('/api/auth/login', { headers, data: { username: 'simple_admin', password } })).ok()).toBe(true);
    const name = `Design tea ${width}`;
    expect((await page.request.post('/api/menu', { headers, data: {
      name, category: 'tea', unit: 'কাপ', available: true, archived: false,
    } })).status()).toBe(201);
    await page.goto('/');
    const increase = page.getByRole('button', { name: `Increase ${name}`, exact: true });
    await increase.click();
    await page.getByLabel('Note (optional)', { exact: false }).fill('Keep this draft');
    for (const [id, label] of [['counter', 'Counter'], ['ticket', 'Ticket'], ['night', 'Night shift'], ['compact', 'Quick list']]) {
      const picker = page.getByRole('button', { name: label, exact: true });
      await picker.click();
      await expect(picker).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-design', id);
      await expect(page.getByLabel('Note (optional)', { exact: false })).toHaveValue('Keep this draft');
      await expect(increase.locator('..').locator('output')).toHaveText('1');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const target = await increase.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `test-results/designs/${id}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    await page.reload();
    await expect(page.getByRole('button', { name: 'Quick list', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Note (optional)', { exact: false })).toHaveValue('Keep this draft');
    await page.getByRole('button', { name: `Decrease ${name}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Decrease ${name}`, exact: true })).toBeDisabled();
  });
}
