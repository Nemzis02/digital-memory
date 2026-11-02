import { defineConfig } from 'vitest/config';

// Runs against a real Postgres and Qdrant; `npm run test:integration` loads `.env` when present.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['src/test/integration-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
