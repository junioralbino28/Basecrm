import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('useRealtimeSync tasks support (N2)', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'),
    'utf-8'
  );

  it('inclui tasks na union RealtimeTable', () => {
    expect(src).toContain("| 'tasks'");
  });

  it('mapeia tasks para a query key simples', () => {
    expect(src).toContain('tasks: [queryKeys.tasks.all]');
  });
});
