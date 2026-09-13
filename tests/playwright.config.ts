import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: 'npx vite --port 3001 --host',
    cwd: '../webapp',
    port: 3001,
    timeout: 30000,
  },
});
