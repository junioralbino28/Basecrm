import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('useRealtimeSync professionals support', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'),
    'utf-8'
  );

  it('inclui professionals na union RealtimeTable', () => {
    expect(src).toContain("| 'professionals'");
  });

  it('mapeia professionals para a query key simples', () => {
    expect(src).toContain('professionals: [queryKeys.professionals.all]');
  });
});
