import { defineConfig } from "evalite/config";

// Load ANTHROPIC_API_KEY from .env when present (never committed).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on the real environment (e.g. CI secrets).
}

export default defineConfig({
  // A full conversation takes several model calls.
  testTimeout: 300_000,
  // Set scoreThreshold after the first full run shows the baseline.
});
