import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável (o cabeçalho explica a decisão em prosa).
const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260913010000_conversao_marcos_por_negocio.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

const funcao = (nome: string) => {
  const s = sql();
  const start = s.indexOf(`function public.${nome}()`);
  const end = s.indexOf('$$;', start) + 3;
  return s.slice(start, end);
};

describe('3b — marcos de conversão por negócio (migration)', () => {
  it('a agenda aponta o negócio e os marcos são append-only com id único por evento', () => {
    const s = sql();
    expect(s).toContain('alter table public.appointments\n  add column deal_id uuid');
    expect(s).toContain('references public.deals(organization_id, id)\n    on delete set null');
    expect(s).toContain('create table public.deal_conversion_events');
    expect(s).toContain("check (event_type in ('replied', 'scheduled', 'attended', 'no_show', 'won'))");
    expect(s).toContain('meta_event_id uuid not null default gen_random_uuid()');
    expect(s).toContain('unique (organization_id, idempotency_key)');
    expect(s).toContain('unique (organization_id, meta_event_id)');
  });

  it('cliente autenticado só lê a própria organização; escrita é dos gatilhos e do service_role', () => {
    const s = sql();
    // R-09: os defaults do Supabase dão TRUNCATE a anon/authenticated; a migration zera antes de conceder.
    expect(s).toContain('revoke all on table public.deal_conversion_events from public, anon, authenticated;');
    expect(s.indexOf('revoke all on table public.deal_conversion_events')).toBeLessThan(
      s.indexOf('grant select on table public.deal_conversion_events to authenticated;')
    );
    expect(s).toContain('grant select on table public.deal_conversion_events to authenticated;');
    expect(s).toContain('grant all on table public.deal_conversion_events to service_role;');
    expect(s).toContain('for select to authenticated\n  using (public.can_access_organization(organization_id));');
    expect(s).not.toMatch(/for (insert|update|delete|all) to authenticated/i);
    for (const f of ['appointments_link_deal', 'appointments_conversion_events', 'deals_conversion_events']) {
      expect(funcao(f)).toContain('security definer');
      expect(funcao(f)).toContain("set search_path = ''");
      expect(s).toContain(`revoke all on function public.${f}() from public, anon, authenticated;`);
    }
  });

  it('agendou nasce da agenda ligada ao negócio; compareceu na hora da consulta; faltou nunca vai à Meta', () => {
    const f = funcao('appointments_conversion_events');
    expect(f).toContain("'scheduled', now()");
    expect(f).toContain("'scheduled:' || new.id::text");
    expect(f).toContain("if new.status = 'compareceu' then");
    expect(f).toContain("'attended', new.starts_at");
    expect(f).toContain("elsif old.status = 'compareceu' then");
    expect(f).toContain("set meta_status = 'skipped'");
    expect(f).toContain("'no_show', new.starts_at");
    expect(f).toContain("'no_show:' || new.id::text, 'skipped'");
    expect(f).toContain("case when new.source = 'clinicorp_api' then 'clinicorp' else 'agenda' end");
  });

  it('o ganho vem de gatilho na tabela (cobre os 9 caminhos de UPDATE), com valor e reabertura', () => {
    const f = funcao('deals_conversion_events');
    expect(f).toContain("if new.is_won and (tg_op = 'INSERT' or not coalesce(old.is_won, false)) then");
    expect(f).toContain("'won', v_closed");
    expect(f).toContain('coalesce(new.value, 0)');
    expect(f).toContain("elsif tg_op = 'UPDATE' and coalesce(old.is_won, false) and not new.is_won then");
    expect(sql()).toContain('after insert or update of is_won on public.deals');
  });

  it('liga a consulta ao negócio aberto mais recente do contato; backfill só do vínculo, sem marco retroativo', () => {
    const link = funcao('appointments_link_deal');
    expect(link).toContain('if new.deal_id is null and new.contact_id is not null then');
    expect(link).toContain('and d.is_won = false\n      and d.is_lost = false');
    expect(link).toContain('order by d.updated_at desc, d.created_at desc');

    const s = sql();
    const backfillAt = s.indexOf('update public.appointments a');
    const triggersAt = s.indexOf('create trigger appointments_link_deal');
    expect(backfillAt).toBeGreaterThan(0);
    // O backfill roda ANTES de ligar os gatilhos: vínculo antigo não vira marco retroativo.
    expect(backfillAt).toBeLessThan(triggersAt);
    const backfill = s.slice(backfillAt, triggersAt);
    expect(backfill).toContain('where a.deal_id is null\n  and a.contact_id is not null;');
    expect(backfill).not.toContain('deal_conversion_events');
  });
});
