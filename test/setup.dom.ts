import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const hasDom = typeof document !== 'undefined';

if (hasDom) {
  const g = globalThis as typeof globalThis & {
    window?: unknown;
    navigator?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  if (typeof g.window === 'undefined') {
    g.window = globalThis;
  }

  if (typeof g.navigator === 'undefined') {
    g.navigator = { userAgent: 'vitest' };
  }

  await import('@testing-library/jest-dom/vitest');
  g.IS_REACT_ACT_ENVIRONMENT = true;
}

afterEach(() => {
  if (hasDom) {
    cleanup();
  }
});
