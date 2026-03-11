import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    environmentMatchGlobs: [
      ['test/aiToolsRbac.test.ts', 'node'],
      ['test/supabaseMiddleware.test.ts', 'node'],
      ['test/publicApiOpenapi.test.ts', 'node'],
      ['test/publicApiCursor.test.ts', 'node'],
      ['test/tools.salesTeamMatrix.test.ts', 'node'],
      ['test/tools.multiTenant.test.ts', 'node'],
      ['lib/utils/csv.test.ts', 'node'],
      ['lib/query/__tests__/cache-integrity.test.ts', 'node'],
    ],
    setupFiles: ['test/setup.ts', 'test/setup.dom.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist', 'tmp', '**/*.bak', '**/*.bkp'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
