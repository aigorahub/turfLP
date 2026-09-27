import { defineConfig } from "vitest/config";

// Solves are synchronous WebAssembly calls that hold a worker for seconds on
// the largest fixtures. Child processes keep the test runner responsive.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 120_000, pool: "forks" },
});
