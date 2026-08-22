import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The pure modules under src/scene are the only tested code: no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
