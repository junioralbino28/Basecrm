/**
 * A lista de rotas do workspace tem que bater com as pastas em disco.
 *
 * Caso real (producao, 24/09/2026): o Junior trocou de cliente estando na tela de Conversas e
 * caiu em `crm.basea2.com/conversations` com 404, na Dra. Jessica e na FM Vistos. O seletor do
 * cabecalho remonta o caminho pelo `getTenantWorkspaceHref`; como `/conversations` nao estava na
 * lista, ele devolvia o caminho SEM o prefixo do cliente — e essa rota so existe sob o tenant.
 * Faltavam seis rotas, nao uma.
 *
 * Este teste le `app/(protected)/platform/tenants/[tenantId]/` e exige que cada rota real passe
 * pelo `getTenantWorkspaceHref`. Rota nova sem entrada na lista quebra aqui, nao na tela.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  getTenantWorkspaceHref,
  getTenantWorkspaceRelativeHref,
  isTenantWorkspacePath,
} from './workspaceRoutes';

const TENANT = 'bd43a9bc-5bab-410a-a5a6-c214f3836f0e';
const OUTRO = '11111111-1111-4111-8111-111111111111';
const BASE = path.resolve(__dirname, '..', '..', 'app', '(protected)', 'platform', 'tenants', '[tenantId]');

/** Cada `page.tsx` sob [tenantId] vira o caminho relativo dela ('/conversations', '/reports/financeiro'). */
function rotasEmDisco(dir = BASE, prefixo = ''): string[] {
  const achadas: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      // Segmento dinamico (`[dealId]`) nao e uma rota base do menu.
      if (entrada.name.startsWith('[') || entrada.name.startsWith('(')) continue;
      achadas.push(...rotasEmDisco(path.join(dir, entrada.name), `${prefixo}/${entrada.name}`));
    } else if (entrada.name === 'page.tsx' && prefixo) {
      achadas.push(prefixo);
    }
  }
  return achadas;
}

describe('rotas do workspace do cliente', () => {
  const rotas = rotasEmDisco().sort();

  it('encontra as rotas em disco (se isto falhar, o caminho da pasta mudou)', () => {
    expect(rotas.length).toBeGreaterThan(10);
    expect(rotas).toContain('/conversations');
  });

  it.each(rotas)('%s ganha o prefixo do cliente ao trocar de cliente', rota => {
    const resolvida = getTenantWorkspaceHref(rota, TENANT);
    expect(
      resolvida,
      `"${rota}" existe sob [tenantId] mas saiu sem o prefixo — trocar de cliente nesta tela cai em 404. `
        + 'Adicione em TENANT_SCOPED_BASE_ROUTES (lib/tenancy/workspaceRoutes.ts).',
    ).toBe(`/platform/tenants/${TENANT}${rota}`);
  });

  it('o caminho inteiro do seletor: estar no cliente A e trocar para o B mantem a tela', () => {
    // Exatamente o que o TenantClinicSwitcher faz.
    const atual = `/platform/tenants/${OUTRO}/conversations`;
    expect(isTenantWorkspacePath(atual)).toBe(true);
    const relativa = getTenantWorkspaceRelativeHref(atual);
    expect(relativa).toBe('/conversations');
    expect(getTenantWorkspaceHref(relativa, TENANT)).toBe(`/platform/tenants/${TENANT}/conversations`);
  });

  it('rota que NAO e do workspace continua intacta', () => {
    expect(getTenantWorkspaceHref('/platform/tenants', TENANT)).toBe('/platform/tenants');
    expect(getTenantWorkspaceHref('/platform', TENANT)).toBe('/platform');
  });

  it('/pipeline continua caindo em /boards', () => {
    expect(getTenantWorkspaceHref('/pipeline', TENANT)).toBe(`/platform/tenants/${TENANT}/boards`);
  });
});
