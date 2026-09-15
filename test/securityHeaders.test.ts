// @vitest-environment node
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function rules(): Promise<HeaderRule[]> {
  const fn = nextConfig.headers;
  if (!fn) throw new Error('next.config sem headers()');
  return (await fn()) as HeaderRule[];
}

describe('cabeçalhos de segurança (gate G25; achado de 14/09)', () => {
  it('toda resposta leva nosniff, anti-iframe, referrer, permissions e HSTS', async () => {
    const all = (await rules()).find((rule) => rule.source === '/(.*)');
    expect(all, 'regra global /(.*)').toBeTruthy();
    const map = Object.fromEntries(all!.headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(map['x-content-type-options']).toBe('nosniff');
    expect(map['x-frame-options']).toBe('DENY');
    expect(map['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(map['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(map['permissions-policy']).toMatch(/camera=\(\)/);
    expect(map['permissions-policy']).toMatch(/geolocation=\(\)/);
    expect(map['strict-transport-security']).toMatch(/max-age=\d+; includeSubDomains/);
  });

  it('mantém a regra do service worker (sem cache)', async () => {
    const sw = (await rules()).find((rule) => rule.source === '/sw.js');
    expect(sw?.headers.some((h) => h.key === 'Cache-Control' && h.value === 'no-cache')).toBe(true);
  });
});
