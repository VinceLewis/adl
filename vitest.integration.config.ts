import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real PostgreSQL (provisioned as a throwaway
 * Docker container by the global setup) and a real local HTTP server. They are
 * deliberately separate from the fast hermetic unit suite so `npm test` stays
 * dependency-free.
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // One shared database; run integration files serially to keep truncation
    // between tests deterministic.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
