import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'office-ui-'));
const database = join(directory, 'browser.sqlite');
export default defineConfig({
  metadata: { database },
  testDir: './e2e-ui',
  workers: 1,
  timeout: 90000,
  use: { baseURL: 'http://localhost:5195', headless: true },
  webServer: [
    {
      command: 'bun apps/api/main.ts',
      url: 'http://localhost:3025/api/setup',
      env: {
        PORT: '3025',
        APP_ORIGIN: 'http://localhost:5195',
        AUTH_SECRET: 'ui-browser-auth-secret-32-characters',
        SETUP_TOKEN: 'ui-browser-setup-token-32-characters',
        DATABASE_PATH: database,
      },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @office-service/web dev --port 5195',
      url: 'http://localhost:5195',
      env: { API_ORIGIN: 'http://localhost:3025' },
      reuseExistingServer: false,
    },
  ],
});
