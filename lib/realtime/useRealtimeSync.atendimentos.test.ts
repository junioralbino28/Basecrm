import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'),
  'utf-8'
);

describe('realtime sync — atendimentos', () => {
  it('inclui atendimentos na union RealtimeTable', () => {
    expect(src).toContain("| 'atendimentos'");
  });

  it('mapeia atendimentos para sua query key (caminho simples invalidate)', () => {
    expect(src).toContain('atendimentos: [queryKeys.atendimentos.all]');
  });
});
