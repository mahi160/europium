import { test, expect } from '../e2e/test';

const headers = { Origin: 'http://localhost:5195' };
const password = 'simple-browser-admin-password-123';

for (const width of [1440, 768, 390]) {
  test(`keyboard and mobile controls preserve drafts at ${width}px`, async ({ page }) => {
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
    const item = page.getByRole('button', { name, exact: true });
    await item.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Send order (1)', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Note (optional)', exact: true }).click();
    await page.getByLabel('Note (optional)', { exact: false }).fill('Keep this draft');
    for (const [key, count] of [['Enter', 2], ['Space', 3]] as const) {
      await item.focus();
      await page.keyboard.press(key);
      await expect(page.getByRole('button', { name: `Send order (${count})`, exact: true })).toBeEnabled();
      await expect(page.getByLabel('Note (optional)', { exact: false })).toHaveValue('Keep this draft');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const target = await item.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `test-results/designs/${key}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    await page.reload();
    await expect(page.getByRole('button', { name: 'Send order (3)', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Note (optional)', { exact: false })).toHaveValue('Keep this draft');
    await page.getByRole('button', { name: `Decrease ${name}`, exact: true }).click();
    await page.getByRole('button', { name: `Decrease ${name}`, exact: true }).click();
    await page.getByRole('button', { name: `Decrease ${name}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Decrease ${name}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send order (0)', exact: true })).toBeDisabled();
    await page.screenshot({ path: `test-results/designs/cleared-${width}.png`, fullPage: true, animations: 'disabled' });
  });
}
