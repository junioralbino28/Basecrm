import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável (o cabeçalho explica a decisão em prosa).
const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260913030000_conversao_replied_regiao.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

describe('3d — "lead respondeu e é da região" (migration)', () => {
  it('região por DDD do cliente; lista vazia = qualquer região; sem 55 na frente não é do Brasil', () => {
    const s = sql();
    expect(s).toContain('select coalesce(conversion_region_ddds, \'{}\') into v_ddds');
    expect(s).toContain("when v_digits like '55%' and length(v_digits) between 12 and 13 then substr(v_digits, 3, 2)");
    expect(s).toContain('coalesce(array_length(v_ddds, 1), 0) = 0 or (v_ddd is not null and v_ddd = any(v_ddds))');
  });

  it('o marco nasce sempre; fora da região já nasce skipped com motivo e nunca vai à Meta; um por negócio', () => {
    const s = sql();
    expect(s).toContain("'replied', coalesce(p_occurred_at, now()), 'system'");
    expect(s).toContain("'replied:' || p_deal_id::text");
    expect(s).toContain("case when v_na_regiao then 'pending' else 'skipped' end");
    expect(s).toContain("case when v_na_regiao then null else 'fora_da_regiao' end");
    expect(s).toContain('on conflict (organization_id, idempotency_key) do nothing');
  });

  it('só o servidor chama: INVOKER, search_path vazio, EXECUTE só do service_role', () => {
    const s = sql();
    expect(s).toContain('security invoker');
    expect(s).toContain("set search_path = ''");
    expect(s).toContain('revoke all on function public.record_lead_replied_event(uuid, uuid, uuid, timestamptz, text)\n  from public, anon, authenticated;');
    expect(s).toContain('grant execute on function public.record_lead_replied_event(uuid, uuid, uuid, timestamptz, text)\n  to service_role;');
    expect(s).not.toMatch(/grant execute[^;]*to[^;]*\b(anon|authenticated)\b/i);
  });
});

describe('3d — encaixe no webhook da Evolution', () => {
  const rota = readFileSync(join(
    process.cwd(), 'app', 'api', 'public', 'channels', 'evolution', '[connectionId]', 'webhook', 'route.ts',
  ), 'utf8').replace(/\r\n/g, '\n');

  it('só em inbound, com negócio, depois de a clínica ter falado; sem derrubar o webhook', () => {
    expect(rota).toContain("readConversationThreadMetadata(threadResult.data?.metadata).lastOutboundAt");
    expect(rota).toContain("if (parsed.direction === 'inbound' && dealId && previousOutboundAt) {");
    expect(rota).toContain("rpc('record_lead_replied_event'");
    expect(rota).toContain('p_phone: canonicalPhone');

    const inicio = rota.indexOf("if (parsed.direction === 'inbound' && dealId && previousOutboundAt) {");
    const fim = rota.indexOf('const currentConnectionMetadata', inicio);
    const bloco = rota.slice(inicio, fim);
    expect(bloco).not.toContain('return json(');
    expect(bloco).toContain('Falha ao registrar resposta do lead');
    // Vem depois do clique de anúncio e antes da atualização da conexão.
    expect(inicio).toBeGreaterThan(rota.indexOf("rpc('record_whatsapp_ad_attribution'"));
  });
});
