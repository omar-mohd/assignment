import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { root: '.', include: ['test/**/*.test.js'], environment: 'node', testTimeout: 20000 },
});
