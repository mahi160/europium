import { defineConfig } from 'vite-plus';

export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  test: { include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'], testTimeout: 30000 },
  lint: { ignorePatterns: ['dist/**', 'node_modules/**', '.scratch/**'] },
  fmt: { singleQuote: true },
  run: {
    tasks: {
      'api:dev': { command: 'bun --watch apps/api/main.ts', cache: false },
      'api:start': { command: 'bun apps/api/main.ts', cache: false },
      types: { command: 'tsc --noEmit', cache: false },
    },
  },
});
