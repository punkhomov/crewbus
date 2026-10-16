import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["apps/**/test/**/*.test.ts", "packages/**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**", "**/*.spec.ts"],
  },
});
