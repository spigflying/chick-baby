import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://chick:chick@localhost:5432/chick_test',
      DEV_LOGIN: '1', ADMIN_EMAILS: 'boss@dev.local', CRON_SECRET: 'test-cron', PUBLIC_ORIGIN: 'http://localhost:5173',
    },
  },
});
