// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const credenciais = vi.hoisted(() => vi.fn());
vi.mock('@/lib/channels/evolutionCredentials', () => ({ resolveEvolutionCredentials: credenciais }));
vi.mock('@/lib/channels/evolution', () => ({ findEvolutionWebhook: vi.fn() }));

import { conferirWebhookDoNumero } from './webhookDoNumero';

const CONEXAO = '20532687-e868-48c4-977b-f6f7cac72131';
const ORG = '11111111-1111-4111-8111-111111111111';
const PRODUCAO = ['crm.basea2.com', 'crm.cennohub.com.br', 'basecrm.vercel.app'];
const CERTO = `https://crm.basea2.com/api/public/channels/evolution/${CONEXAO}/webhook`;

function admin(linha: Record<string, unknown> | null) {
  const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: () => Promise.resolve({ data: linha, error: null }) };
  return { from: () => consulta } as unknown as SupabaseClient;
}
const NUMERO = { id: CONEXAO, organization_id: ORG, provider: 'evolution', config: { instanceName: 'whatsapp-ia-bba4d621' } };
const achado = (url: string | null, enabled: boolean | null) => vi.fn().mockResolvedValue({ raw: {}, enabled, url, headers: { 'x-segredo': 'SEGREDO' }, events: [] });

beforeEach(() => {
  credenciais.mockReset();
  credenciais.mockResolvedValue({ apiUrl: 'https://evo.exemplo.com', apiKey: 'CHAVE', source: 'agency_defaults', agencyOrganizationId: 'ag' });
});

describe('conferirWebhookDoNumero', () => {
  it('confere: ligado, https, domínio da lista e o caminho deste número', async () => {
    const buscarWebhook = achado(CERTO, true);
    expect(await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook }))
      .toEqual({ ok: true, host: 'crm.basea2.com' });
    expect(buscarWebhook).toHaveBeenCalledWith({ apiUrl: 'https://evo.exemplo.com', instanceName: 'whatsapp-ia-bba4d621', apiKey: 'CHAVE' });
    expect(credenciais).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ORG, connectionConfig: NUMERO.config }));
  });

  it('a query com segredo não é conferida nem sai no resultado', async () => {
    const r = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook: achado(`${CERTO}?token=SEGREDO`, true) });
    expect(r).toEqual({ ok: true, host: 'crm.basea2.com' });
    const fora = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: ['teste.crm.basea2.com'], buscarWebhook: achado(`${CERTO}?token=SEGREDO`, true) });
    expect(fora.ok).toBe(false);
    expect(JSON.stringify(fora)).not.toContain('SEGREDO');
  });

  it.each([
    ['desligado', achado(CERTO, false), 'webhook_desligado'],
    ['prévia', achado(`https://basecrm-git-feat-funil-construtor-x.vercel.app/api/public/channels/evolution/${CONEXAO}/webhook`, true), 'webhook_fora_da_lista'],
    ['outro número', achado('https://crm.basea2.com/api/public/channels/evolution/outro/webhook', true), 'webhook_fora_da_lista'],
    ['http', achado(CERTO.replace('https:', 'http:'), true), 'webhook_fora_da_lista'],
    ['porta', achado(CERTO.replace('crm.basea2.com', 'crm.basea2.com:8443'), true), 'webhook_fora_da_lista'],
    ['sem url', achado(null, true), 'webhook_ilegivel'],
  ])('%s: recusa', async (_nome, buscarWebhook, motivo) => {
    const r = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook });
    expect(r).toMatchObject({ ok: false, motivo });
  });

  it('a leitura na Evolution falhou: recusa sem imprimir o que a Evolution respondeu', async () => {
    const buscarWebhook = vi.fn().mockRejectedValue(new Error('Instance not found SEGREDO'));
    const r = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook });
    expect(r).toMatchObject({ ok: false, motivo: 'webhook_ilegivel' });
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
  });

  it('número que não existe, sem instância, de outro provedor ou sem credencial: recusa antes de chamar a Evolution', async () => {
    const buscarWebhook = achado(CERTO, true);
    expect(await conferirWebhookDoNumero({ admin: admin(null), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'conexao_inexistente' });
    expect(await conferirWebhookDoNumero({ admin: admin({ ...NUMERO, config: {} }), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'sem_instancia' });
    expect(await conferirWebhookDoNumero({ admin: admin({ ...NUMERO, provider: 'outro' }), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'conexao_nao_evolution' });
    credenciais.mockResolvedValueOnce(null);
    expect(await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'sem_credenciais' });
    expect(buscarWebhook).not.toHaveBeenCalled();
  });
});
