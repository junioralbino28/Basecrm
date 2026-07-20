import { describe, expect, it } from 'vitest';
import { resolveNpxInvocation } from '../npx-invocation.mjs';

describe('dev-local resolveNpxInvocation', () => {
  it('usa cmd.exe para executar npx.cmd no Windows sem spawn EINVAL', () => {
    expect(resolveNpxInvocation(
      ['supabase', 'status', '-o', 'env'],
      { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' },
    )).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npx.cmd', 'supabase', 'status', '-o', 'env'],
    });
  });

  it('mantém npx direto fora do Windows', () => {
    expect(resolveNpxInvocation(
      ['next', 'dev'],
      { platform: 'linux' },
    )).toEqual({
      file: 'npx',
      args: ['next', 'dev'],
    });
  });
});
