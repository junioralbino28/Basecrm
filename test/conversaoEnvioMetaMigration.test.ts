import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável (o cabeçalho explica a decisão em prosa).
const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260913020000_conversao_envio_meta.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

describe('3c — envio à Meta (migration)', () => {
  it('configuração por cliente: o token de acesso NÃO ganha SELECT para o navegador (padrão M6)', () => {
    const s = sql();
    expect(s).toContain('add column meta_capi_access_token text');
    const grant = s.slice(s.indexOf('grant select ('), s.indexOf('on public.organization_settings to authenticated;'));
    expect(grant).toContain('meta_capi_enabled');
    expect(grant).toContain('meta_capi_dataset_id');
    expect(grant).toContain('meta_capi_event_map');
    expect(grant).toContain('conversion_region_ddds');
    expect(grant).not.toContain('meta_capi_access_token');
  });

  it('mapa padrão de eventos usa só nomes de mensageria da doc; faltou (attended) fica para o Junior decidir', () => {
    const s = sql();
    expect(s).toContain('"replied": "LeadSubmitted"');
    expect(s).toContain('"scheduled": "QualifiedLead"');
    expect(s).toContain('"attended": null');
    expect(s).toContain('"won": "Purchase"');
    expect(s).toContain("check (jsonb_typeof(meta_capi_event_map) = 'object')");
  });

  it('reserva com lease e skip locked, só de clientes ligados e configurados; conclusão com retry', () => {
    const s = sql();
    expect(s).toContain('for update of e skip locked');
    expect(s).toContain("where e.meta_status = 'pending'");
    expect(s).toContain('and s.meta_capi_enabled = true');
    expect(s).toContain("nullif(btrim(coalesce(s.meta_capi_access_token, '')), '') is not null");
    expect(s).toContain('meta_attempts = e.meta_attempts + 1');
    expect(s).toContain("if p_status not in ('sent', 'error', 'skipped', 'pending') then");
    expect(s).toContain("meta_sent_at = case when p_status = 'sent' then now() else meta_sent_at end");
    expect(s).toContain("when p_status = 'pending' and p_retry_in_seconds is not null");
  });

  it('as duas funções são INVOKER com search_path vazio e só o service_role executa', () => {
    const s = sql();
    expect(s.match(/security invoker/g)).toHaveLength(2);
    expect(s.match(/set search_path = ''/g)).toHaveLength(2);
    expect(s).toContain('revoke all on function public.claim_conversion_events(integer, integer)\n  from public, anon, authenticated;');
    expect(s).toContain('revoke all on function public.complete_conversion_event(uuid, uuid, text, text, text, integer)\n  from public, anon, authenticated;');
    expect(s).not.toMatch(/grant execute[^;]*to[^;]*\b(anon|authenticated)\b/i);
  });
});
