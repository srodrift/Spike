import { defineConfig } from '@playwright/test';

// Use the already-running managed Vite workflow through the artifact proxy.
export default defineConfig({
  testDir: './e2e',
  outputDir: '../../generated-artifacts/walk-browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.WALK_TEST_BASE_URL || 'http://localhost:80',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
});
