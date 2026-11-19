import { defineConfig } from 'vite-plus';

export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  test: { include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'], testTimeout: 30000 },
  lint: { ignorePatterns: ['dist/**', 'node_modules/**', '.scratch/**'] },
  fmt: { singleQuote: true },
  run: {
    tasks: {
      'api:dev': { command: 'tsx watch apps/api/src/server.ts', cache: false },
      'api:start': { command: 'tsx apps/api/src/server.ts', cache: false },
      types: { command: 'tsc --noEmit', cache: false },
    },
  },
});
