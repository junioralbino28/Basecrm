/**
 * O CRM e multi-nicho: no texto que vai para a tela o tenant se chama CLIENTE, nunca "clinica".
 *
 * Decisao travada em 14/09/2026 (`02-Decisions/2026-09-14-basecrm-plataforma-modular-menu-agentes`,
 * item 7) e aplicada em 24/09 a pedido do Junior, que encontrou "Clinicas"/"Nova Clinica" ainda
 * no menu da agencia depois do rebranding.
 *
 * O que este teste NAO proibe, e por que:
 * - `clinic_admin`, `clinic_staff`, `edition: 'clinic'`, colunas: sao valores gravados no banco e
 *   usados na RLS — trocar pede migration;
 * - `brandTheme: 'clinica'` / `[data-brand="clinica"]`: chave do tema em `branding_config`;
 * - nome de variavel (`isClinicAdmin`, `selectedClinicId`): nao aparece na tela;
 * - Clinicorp (`app/api/agenda/*`, `lib/channels/clinicorp*`): integracao com software DE
 *   clinica, onde a palavra esta certa — ha "dentistas" na mesma frase;
 * - comentario de codigo: nao aparece na tela.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(__dirname, '..');
const PASTAS = ['app', 'components', 'context', 'features', 'lib'];
const IGNORAR_PASTA = new Set(['node_modules', '.next', 'dist', 'coverage']);

/** Caminhos onde "clinica" e a palavra certa. */
const PERMITIDO = [
  path.join('app', 'api', 'agenda'),
  path.join('lib', 'channels', 'clinicorp'),
  path.join('lib', 'branding', 'brandTheme.ts'),
];

/** Identificador, chave de banco ou nome de variavel na mesma linha do texto. */
const LINHA_TECNICA =
  /brandTheme|data-brand|BRAND_THEME|'clinica'|"clinica"|clinic_|Clinicorp|clinicorp|isClinicAdmin|selectedClinic|hasActiveClinic|ClinicAdmin/;
const LINHA_COMENTARIO = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

function varrer(dir: string, achados: string[] = []): string[] {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR_PASTA.has(entrada.name)) continue;
    const completo = path.join(dir, entrada.name);
    const rel = path.relative(RAIZ, completo);
    if (PERMITIDO.some(p => rel.startsWith(p))) continue;
    if (entrada.isDirectory()) {
      varrer(completo, achados);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entrada.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entrada.name)) continue;

    const linhas = fs.readFileSync(completo, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
      if (!/[Cc]l[íi]nica/.test(linha)) return;
      if (LINHA_TECNICA.test(linha) || LINHA_COMENTARIO.test(linha)) return;
      achados.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 110)}`);
    });
  }
  return achados;
}

describe('vocabulário do produto — o tenant se chama CLIENTE', () => {
  it('nenhum texto de tela chama o tenant de "clínica"', () => {
    const achados = PASTAS.flatMap(p => varrer(path.join(RAIZ, p)));
    expect(achados, `Troque por "cliente" (concordância no masculino):\n${achados.join('\n')}`).toEqual([]);
  });

  it('o menu da agência diz Clientes e Novo Cliente', () => {
    const nav = fs.readFileSync(path.join(RAIZ, 'components', 'navigation', 'navConfig.ts'), 'utf8');
    expect(nav).toContain("label: 'Clientes'");
    expect(nav).toContain("label: 'Novo Cliente'");
  });

  it('o identificador técnico NÃO foi renomeado junto — isso quebraria a RLS', () => {
    const scope = fs.readFileSync(path.join(RAIZ, 'lib', 'auth', 'scope.ts'), 'utf8');
    expect(scope).toContain('clinic_admin');
    expect(scope).toContain('clinic_staff');
  });
});
