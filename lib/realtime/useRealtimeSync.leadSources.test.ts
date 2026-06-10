import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('useRealtimeSync lead_sources support (N1)', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'),
    'utf-8'
  );

  it('inclui lead_sources na union RealtimeTable', () => {
    expect(src).toContain("| 'lead_sources'");
  });

  it('mapeia lead_sources para a query key simples', () => {
    expect(src).toContain('lead_sources: [queryKeys.leadSources.all]');
  });
});
