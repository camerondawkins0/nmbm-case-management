import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // One database per run, shared by every file. Files run one at a
    // time because a few tests change global state (the former-worker
    // window setting); every test builds its own people, so order
    // within a file doesn't matter.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
