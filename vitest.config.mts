import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, "") } },
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000 },
});
