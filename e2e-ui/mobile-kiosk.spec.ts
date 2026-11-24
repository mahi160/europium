import { expect, test } from '@playwright/test';
import { menuResponseSchema } from '@office-service/shared';

const headers = { Origin: 'http://localhost:5195' };
const password = 'simple-browser-admin-password-123';
test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

for (const width of [390, 320]) {
  test(`mobile kiosk keeps Send reachable and localizes quantities at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 844 });
    const setup = await page.request.get('/api/setup');
    if ((await setup.json()).setupRequired) {
      expect((await page.request.post('/api/setup', { headers, data: {
        name: 'Office admin', username: 'simple_admin', password,
        setupToken: 'ui-browser-setup-token-32-characters', language: 'en', floor: '', desk: '',
      } })).status()).toBe(201);
    }
    expect((await page.request.post('/api/auth/login', { headers, data: { username: 'simple_admin', password } })).ok()).toBe(true);
    const username = `mobile_kiosk_${width}`;
    expect((await page.request.post('/api/users', { headers, data: {
      name: 'Nadia Rahman', username, password: '0000', role: 'employee', language: 'en', floor: '3', desk: '12',
    } })).status()).toBe(201);
    expect((await page.request.post('/api/auth/login', { headers, data: { username, password: '0000' } })).ok()).toBe(true);
    expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: '0000', newPassword: '0042' } })).ok()).toBe(true);
    await page.goto('/');
    await expect(page.locator('[data-realtime="current"]')).toBeVisible();
    const menu = menuResponseSchema.parse(await (await page.request.get('/api/menu')).json());
    const lastItem = menu.items.filter(item => item.available && !item.archived).at(-1);
    if (!lastItem) throw new Error('The seeded menu must include an available refreshment');
    for (const language of ['en', 'bn']) {
      await page.locator('.app-header select').selectOption(language);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(language === 'en' ? "Today's refreshments" : 'আজকের চা-নাস্তা');
      await expect(page.locator('[data-realtime="current"]')).toBeVisible();
      const send = page.getByRole('button', { name: language === 'en' ? 'Send order (0)' : 'অর্ডার পাঠান (০)', exact: true });
      await expect(send).toBeDisabled();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/kiosk-mobile-${browserName}-${language}-${width}.png`, fullPage: true, animations: 'disabled' });
      const bar = await send.boundingBox();
      expect(bar).not.toBeNull();
      if (!bar) throw new Error('Missing Send button');
      expect(bar.y + bar.height).toBeLessThanOrEqual(844);
      expect(bar.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Every menu choice must remain reachable by touch.
      const lastChoice = page.locator('.kiosk-choices').getByRole('button', { name: lastItem.name, exact: true });
      await lastChoice.tap();
      const selectedSend = page.getByRole('button', { name: language === 'en' ? 'Send order (1)' : 'অর্ডার পাঠান (১)', exact: true });
      await expect(selectedSend).toBeEnabled();
      const controls = page.locator('.kiosk-order-lines button');
      await expect(controls).toHaveCount(2);
      const sizes = await controls.evaluateAll(buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
      expect(sizes.every(control => control.width >= 44 && control.height >= 44)).toBe(true);
      await page.getByRole('button', { name: language === 'en' ? `Decrease ${lastItem.name}` : `${lastItem.name} কমান`, exact: true }).tap();
      await expect(send).toBeDisabled();
    }
  });
}
