import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    coverage: {
      reporter: ["text", "lcov"],
      exclude: ["**/dist/**", "**/*.d.ts", "**/test/**", "apps/mobile/App.tsx"],
    },
  },
});
