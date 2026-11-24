import { createECDH } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const directory = mkdtempSync(join(tmpdir(), 'office-pwa-browser-'));
const key = createECDH('prime256v1');
key.generateKeys();
export default defineConfig({
  testDir: './e2e-pwa',
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://localhost:5184', headless: true, screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'pnpm exec tsx apps/api/src/server.ts',
      url: 'http://localhost:3014/api/setup',
      env: {
        PORT: '3014',
        APP_ORIGIN: 'http://localhost:5184',
        AUTH_SECRET: 'pwa-browser-auth-secret-32-characters',
        SETUP_TOKEN: 'pwa-browser-setup-token-32-characters',
        DATABASE_PATH: join(directory, 'browser.sqlite'),
        VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url'),
        VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url'),
        VAPID_SUBJECT: 'mailto:operator@example.com',
      },
      reuseExistingServer: false,
    },
    {
      command:
        'pnpm --filter @office-service/web build && pnpm --filter @office-service/web exec vp preview --port 5184',
      url: 'http://localhost:5184',
      env: { API_ORIGIN: 'http://localhost:3014' },
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
