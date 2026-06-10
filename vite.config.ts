/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base per SPEC §Deployment: host-agnostic static dist/.
  base: './',
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
