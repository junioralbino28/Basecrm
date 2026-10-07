// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});
const credenciais = vi.hoisted(() => vi.fn());
vi.mock('@/lib/channels/evolutionCredentials', () => ({ resolveEvolutionCredentials: credenciais }));

import { conferirWebhookDoNumero } from './webhookDoNumero';

const CONEXAO = '20532687-e868-48c4-977b-f6f7cac72131';
const PRODUCAO = ['crm.basea2.com', 'crm.cennohub.com.br', 'basecrm.vercel.app'];
const CERTO = `https://crm.basea2.com/api/public/channels/evolution/${CONEXAO}/webhook`;
const NUMERO = { id: CONEXAO, organization_id: 'org', provider: 'evolution', config: { instanceName: 'whatsapp-ia-bba4d621' } };

function admin() {
  const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: () => Promise.resolve({ data: NUMERO, error: null }) };
  return { from: () => consulta } as unknown as SupabaseClient;
}
const respostaDaEvolution = (corpo: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('conferirWebhookDoNumero com o leitor real da Evolution', () => {
  it.each([
    ['formato plano', { enabled: true, url: `${CERTO}?token=SEGREDO`, events: ['MESSAGES_UPSERT'], headers: { Authorization: 'SEGREDO' } }],
    ['formato aninhado em webhook', { webhook: { enabled: true, url: CERTO, events: ['MESSAGES_UPSERT'] } }],
  ])('%s: confere, pedindo GET /webhook/find/<instância>', async (_nome, corpo) => {
    credenciais.mockResolvedValue({ apiUrl: 'https://evo.exemplo.com', apiKey: 'CHAVE' });
    const fetchMock = respostaDaEvolution(corpo);
    vi.stubGlobal('fetch', fetchMock);
    const r = await conferirWebhookDoNumero({ admin: admin(), connectionId: CONEXAO, dominios: PRODUCAO });
    expect(r).toEqual({ ok: true, host: 'crm.basea2.com' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://evo.exemplo.com/webhook/find/whatsapp-ia-bba4d621');
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
  });

  it('webhook desligado na resposta crua: recusa como desligado', async () => {
    credenciais.mockResolvedValue({ apiUrl: 'https://evo.exemplo.com', apiKey: 'CHAVE' });
    vi.stubGlobal('fetch', respostaDaEvolution({ enabled: false, url: CERTO }));
    expect(await conferirWebhookDoNumero({ admin: admin(), connectionId: CONEXAO, dominios: PRODUCAO })).toMatchObject({
      ok: false,
      motivo: 'webhook_desligado',
    });
  });
});
