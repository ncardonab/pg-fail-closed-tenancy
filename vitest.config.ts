import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Lists every test by name, grouped by file.
    reporters: ['tree'],
    hookTimeout: 30_000,
  },
});
