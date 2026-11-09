import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node ./dist/e2e/fixture-server.js',
    url: 'http://127.0.0.1:4178/api/health',
    timeout: 30000,
    reuseExistingServer: false,
  },
})
