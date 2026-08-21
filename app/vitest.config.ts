import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Type-level contract tests (audit step 17): *.test-d.ts files run under
    // vitest's typecheck so the LLM seam's DECLARED surface is enforced by
    // `npm test`. Scoped to test-d files only — other test files carry
    // pre-existing type debt (worker-url imports, vitest Mock variance) that
    // needs its own infra step before tests/ can join `npm run typecheck`.
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.test-d.json'
    }
  }
})
