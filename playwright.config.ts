import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    trace: "retain-on-failure",
  },
  outputDir: ".artifacts/playwright",
  webServer: [
    {
      command: "exec node --import tsx scripts/e2e-server.ts",
      url: "http://127.0.0.1:3000/api/health",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    {
      command:
        "exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort",
      cwd: "apps/web",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
  ],
});
