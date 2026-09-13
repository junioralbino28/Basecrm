import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável (o cabeçalho explica a decisão em prosa).
const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260913000000_ctwa_captura_clique_anuncio.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

const funcao = () => {
  const s = sql();
  const start = s.indexOf('function public.record_whatsapp_ad_attribution(');
  const end = s.indexOf('revoke all on function public.record_whatsapp_ad_attribution(');
  return s.slice(start, end);
};

describe('3a — captura do clique de anúncio (migration)', () => {
  it('guarda etiqueta e identidade do anúncio no histórico de origem, nada clínico', () => {
    const s = sql();
    for (const coluna of ['ctwa_clid', 'ad_source_id', 'ad_source_url', 'ad_source_app', 'ad_title', 'ad_media_url']) {
      expect(s).toContain(`add column ${coluna} text`);
    }
    expect(s).not.toMatch(/thumbnail|greeting/i);
    expect(s).toContain('create index lead_source_attributions_ctwa_clid');
  });

  it('a origem canônica é uma por organização, automática e reativada se arquivada', () => {
    const f = funcao();
    expect(f).toContain("'Anúncio Meta (WhatsApp)'");
    expect(f).toContain("'meta_whatsapp_ad'");
    expect(f).toContain("'automatic'");
    expect(f).toContain("'whatsapp'");
    expect(f).toContain('on conflict do nothing');
    expect(f).toContain('set active = true, archived_at = null, archived_by = null');
  });

  it('idempotente por conexão + mensagem; primeiro toque preservado; contato só quando vazio', () => {
    const f = funcao();
    expect(f).toContain("'ctwa:' || p_channel_connection_id::text || ':' || v_message_id");
    expect(f).toContain('on conflict (organization_id, idempotency_key) do nothing');
    expect(f).toContain('first_lead_source_id = coalesce(first_lead_source_id, v_source.id)');
    expect(f).toContain('last_lead_source_id = v_source.id');
    expect(f).toContain("and nullif(btrim(coalesce(source, '')), '') is null");
    // O título do anúncio alimenta "por campanha" do relatório comercial.
    expect(f).toContain('channel, campaign, provenance');
  });

  it('cabeçalho de segurança: INVOKER, search_path vazio, só service_role executa', () => {
    const f = funcao();
    expect(f).toContain('security invoker');
    expect(f).toContain("set search_path = ''");

    const s = sql();
    expect(s).toContain('from public, anon, authenticated;');
    expect(s).toContain(') to service_role;');
    expect(s).not.toMatch(/grant[^;]*to[^;]*\b(anon|authenticated)\b/i);
  });
});
