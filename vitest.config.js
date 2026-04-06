import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/lib/**/*.mjs'],
      exclude: ['**/*.test.mjs']
    },
    testTimeout: 10000,
  },
});
