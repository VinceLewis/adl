import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests run against a real Postgres/HTTP backend and are driven
    // by the dedicated `test:integration` config, not the fast hermetic suite.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
});
