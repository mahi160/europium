import { DatabaseSync } from 'node:sqlite';
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export const test = base.extend<{ loginBudget: void }>({
  // Playwright requires an object pattern for the fixtures argument.
  // eslint-disable-next-line no-empty-pattern
  loginBudget: [async ({}, use, info) => {
    const path: unknown = info.config.metadata.database;
    if (typeof path !== 'string') throw new Error('Missing dedicated Playwright database');
    const db = new DatabaseSync(path);
    try {
      // Journeys share a server; each gets its own global login budget, with limits intact within the test.
      db.prepare('DELETE FROM rate_limit WHERE key = ?').run('login');
    } finally { db.close(); }
    await use();
  }, { auto: true }],
});
