// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routePath = resolve(
  process.cwd(),
  'app/api/public/channels/evolution/[connectionId]/webhook/route.ts'
);

describe('webhook Evolution — 3a: clique de anúncio vai pro histórico de origem', () => {
  // O arquivo pode estar em CRLF no Windows; as asserções multilinha usam \n.
  const source = readFileSync(routePath, 'utf-8').replace(/\r\n/g, '\n');

  it('chama a função de sistema só em inbound com clique, com todos os campos do anúncio', () => {
    expect(source).toContain("rpc('record_whatsapp_ad_attribution'");
    expect(source).toContain("if (parsed.direction === 'inbound' && parsed.adClick) {");
    expect(source).toContain('p_channel_connection_id: connectionId');
    expect(source).toContain('p_ctwa_clid: parsed.adClick.ctwaClid');
    expect(source).toContain('p_ad_source_id: parsed.adClick.sourceId');
    expect(source).toContain('p_ad_title: parsed.adClick.title');
    expect(source).toContain('p_deal_id: dealId');
    expect(source).toContain('p_contact_id: contactId');
  });

  it('roda DEPOIS de garantir o negócio, e não derruba o webhook se falhar', () => {
    const rpcAt = source.indexOf("rpc('record_whatsapp_ad_attribution'");
    const dealAt = source.indexOf('dealId = await ensureConversationDeal(');
    expect(dealAt).toBeGreaterThan(0);
    expect(rpcAt).toBeGreaterThan(dealAt);

    const blocoInicio = source.indexOf("if (parsed.direction === 'inbound' && parsed.adClick) {");
    const blocoFim = source.indexOf('const currentConnectionMetadata', blocoInicio);
    const bloco = source.slice(blocoInicio, blocoFim);
    expect(bloco).not.toContain('return json(');
    expect(bloco).toContain('Falha ao registrar clique de anúncio');
    expect(source).toContain('ad_attribution_error: adAttributionError');
  });

  it('o resumo do clique entra na metadata da conversa nas duas trilhas (criar e atualizar)', () => {
    expect(source.match(/adClick: threadAdClick/g)).toHaveLength(2);
    expect(source).toContain("parsed.direction === 'inbound' && parsed.adClick\n      ? {");
  });
});
