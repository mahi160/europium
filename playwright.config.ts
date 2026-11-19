import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'office-browser-'));
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 45000,
  use: { baseURL: 'http://localhost:5183', headless: true },
  webServer: [
    { command: 'pnpm exec tsx apps/api/src/server.ts', url: 'http://localhost:3013/api/setup',
      env: { PORT: '3013', APP_ORIGIN: 'http://localhost:5183', AUTH_SECRET: 'browser-test-auth-secret-32-characters', SETUP_TOKEN: 'browser-test-setup-token-32-characters', DATABASE_PATH: join(directory,'browser.sqlite') }, reuseExistingServer: false },
    { command: 'pnpm --filter @office-service/web dev --port 5183', url: 'http://localhost:5183', env: { API_ORIGIN: 'http://localhost:3013' }, reuseExistingServer: false },
  ],
});
