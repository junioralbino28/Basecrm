// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOOGLE_CALENDAR_OAUTH_ALLOWED_ORIGINS } from '@/lib/googleCalendar/oauth';

/**
 * A lista de origens do OAuth do Google existe em dois lugares: no código e na trava do banco
 * (google_oauth_states_redirect_origin_known). Se divergirem, o botão "Conectar Google Agenda"
 * falha só no endereço que ficou de fora. Este teste lê a ÚLTIMA migration que redefine a trava
 * e exige a mesma lista do código. Ao acrescentar domínio: editar lib/googleCalendar/oauth.ts,
 * criar migration nova recriando a trava e cadastrar o redirect URI no cliente OAuth do Google Cloud.
 */

const pasta = resolve(process.cwd(), 'supabase/migrations');

function origensDaUltimaMigration() {
  const arquivos = readdirSync(pasta)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
    .filter((nome) => readFileSync(resolve(pasta, nome), 'utf8').includes('google_oauth_states_redirect_origin_known'));
  const ultima = arquivos[arquivos.length - 1];
  const sql = readFileSync(resolve(pasta, ultima), 'utf8');
  const bloco = sql.slice(sql.lastIndexOf('redirect_origin in ('));
  const origens = Array.from(bloco.slice(0, bloco.indexOf(')')).matchAll(/'([^']+)'/g), (m) => m[1]);
  return { ultima, origens };
}

describe('origens do OAuth do Google: código e banco iguais', () => {
  it('a última migration da trava lista exatamente as origens do código', () => {
    const { ultima, origens } = origensDaUltimaMigration();
    expect(ultima).toBe('20260929000000_google_oauth_origem_cennohub.sql');
    expect([...origens].sort()).toEqual([...GOOGLE_CALENDAR_OAUTH_ALLOWED_ORIGINS].sort());
  });

  it('o domínio novo do CRM está nas duas listas', () => {
    expect(GOOGLE_CALENDAR_OAUTH_ALLOWED_ORIGINS).toContain('https://crm.cennohub.com.br');
    expect(origensDaUltimaMigration().origens).toContain('https://crm.cennohub.com.br');
  });
});
