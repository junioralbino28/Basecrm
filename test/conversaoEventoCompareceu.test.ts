import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_MESSAGING_EVENT_LABELS_PT,
  CONVERSION_EVENT_TYPE_LABELS_PT,
  DEFAULT_CONVERSION_EVENT_MAP,
} from '@/lib/meta/conversionEventLabels';
import { BUSINESS_MESSAGING_EVENT_NAMES } from '@/lib/meta/conversionsApi';

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8').replace(/\r\n/g, '\n');

describe('3c — "compareceu" vai à Meta como InitiateCheckout (decisão do Junior, 13/09)', () => {
  it('a escada padrão tem os quatro degraus e a tradução de todos os 14 nomes', () => {
    expect(DEFAULT_CONVERSION_EVENT_MAP).toEqual({
      replied: 'LeadSubmitted',
      scheduled: 'QualifiedLead',
      attended: 'InitiateCheckout',
      won: 'Purchase',
    });
    for (const name of BUSINESS_MESSAGING_EVENT_NAMES) {
      expect(BUSINESS_MESSAGING_EVENT_LABELS_PT[name], name).toMatch(/\S/);
    }
    expect(BUSINESS_MESSAGING_EVENT_LABELS_PT.InitiateCheckout).toContain('compareceu');
    expect(CONVERSION_EVENT_TYPE_LABELS_PT.attended).toContain('Compareceu');
  });

  it('a migration muda só o padrão e as linhas ainda sem nome para "compareceu", e grava a tradução na coluna', () => {
    const s = read('supabase', 'migrations', '20260913060000_conversao_evento_compareceu.sql')
      .split('\n')
      .filter((linha) => !linha.trimStart().startsWith('--'))
      .join('\n');
    expect(s).toContain(`set default '{"replied": "LeadSubmitted", "scheduled": "QualifiedLead", "attended": "InitiateCheckout", "won": "Purchase"}'::jsonb;`);
    expect(s).toContain(`where coalesce(meta_capi_event_map->>'attended', '') = '';`);
    expect(s).toContain('comment on column public.organization_settings.meta_capi_event_map is');
    expect(s).toContain('InitiateCheckout = começou a finalizar a compra (compareceu à consulta)');
    expect(s).not.toMatch(/drop|truncate/i);
  });

  it('a rota de configuração usa a mesma escada e devolve as traduções para a tela', () => {
    const rota = read('app', 'api', 'settings', 'meta-capi', 'route.ts');
    expect(rota).toContain('...DEFAULT_CONVERSION_EVENT_MAP,');
    expect(rota).toContain('eventNameLabels: BUSINESS_MESSAGING_EVENT_LABELS_PT,');
    expect(rota).toContain('eventTypeLabels: CONVERSION_EVENT_TYPE_LABELS_PT,');
    expect(rota).not.toContain('attended: null,');
  });

  it('a SPEC registra a decisão e a tradução', () => {
    const spec = read('docs', 'features', 'conversao-meta', 'SPEC.md');
    expect(spec).toContain('compareceu → `InitiateCheckout`');
    expect(spec).toContain('Tradução dos eventos');
    expect(spec).toContain('DDD 22');
  });
});
