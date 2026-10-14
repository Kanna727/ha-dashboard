import { defineConfig } from 'vitest/config';

// Unit tests for pure logic (`npm test`). A separate config from vite.config.ts:
// tests need none of the bundling plugins. They run in plain Node; the setup
// file provides the `window` global and loads the example config the way
// main.tsx does at boot.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'mock/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
