import { expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';

// Registra o matcher toHaveNoViolations no expect do vitest.
// Este módulo é importado por a11y-utils, então qualquer teste que use
// `axe` de '@/lib/a11y/test/a11y-utils' ganha o matcher automaticamente.
expect.extend(matchers);

declare module 'vitest' {
  interface Assertion<T> {
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}

export {};
