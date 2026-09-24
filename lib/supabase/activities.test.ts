/**
 * Trava o defeito do "histórico invisível" (medido em produção em 24/09/2026:
 * 16 atividades, 0 com organization_id, 0 visíveis para qualquer usuário).
 *
 * A RLS de `activities` é `can_access_organization(organization_id)` para ler e
 * `can_operate_organization(organization_id)` para escrever — e as duas devolvem NULL
 * quando o campo é nulo, o que em RLS significa negar. O insert ia sem o campo, e o
 * único chamador engolia o erro com `.catch(console.error)`: ninguém via nada falhar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const single = vi.fn();
const select = vi.fn(() => ({ single }));
const insert = vi.fn(() => ({ select }));
const from = vi.fn(() => ({ insert }));

vi.mock('./client', () => ({
  supabase: { from: (...args: unknown[]) => from(...(args as [])) },
}));

import { activitiesService } from './activities';

const ORG = '11111111-1111-4111-8111-111111111111';
const DEAL = '22222222-2222-4222-8222-222222222222';

const atividade = (extra: Record<string, unknown> = {}) =>
  ({
    dealId: DEAL,
    dealTitle: 'Negócio de teste',
    type: 'STATUS_CHANGE',
    title: 'Moveu para Qualificação',
    date: '2026-09-24T12:00:00.000Z',
    completed: true,
    user: { name: 'Sistema', avatar: '' },
    ...extra,
  }) as any;

describe('activitiesService.create — organização obrigatória', () => {
  beforeEach(() => {
    from.mockClear();
    insert.mockClear();
    select.mockClear();
    single.mockClear();
    single.mockResolvedValue({
      data: { id: 'a1', organization_id: ORG, deal_id: DEAL, title: 'x', type: 'STATUS_CHANGE', date: '2026-09-24T12:00:00.000Z', completed: true, description: null, contact_id: null, created_at: '2026-09-24T12:00:00.000Z', owner_id: null },
      error: null,
    });
  });

  it('recusa e NÃO grava quando a atividade vem sem organização', async () => {
    const { data, error } = await activitiesService.create(atividade());

    expect(data).toBeNull();
    expect(error?.message).toMatch(/organiza/i);
    // O ponto do teste: nada chega ao banco. Gravar sem a organização é pior que
    // falhar, porque nasce invisível e o erro não aparece em lugar nenhum.
    expect(insert).not.toHaveBeenCalled();
  });

  it('recusa quando a organização não é um UUID válido', async () => {
    const { data, error } = await activitiesService.create(atividade({ organizationId: 'org-da-clinica' }));

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
  });

  it('grava organization_id no insert quando a organização vem preenchida', async () => {
    const { data, error } = await activitiesService.create(atividade({ organizationId: ORG }));

    expect(error).toBeNull();
    expect(data?.organizationId).toBe(ORG);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ organization_id: ORG, deal_id: DEAL });
  });
});

describe('quem pode criar atividade', () => {
  const RAIZ = path.resolve(__dirname, '..', '..');
  // Os únicos três pontos que podem chamar `activitiesService.create` no cliente.
  // Cada um injeta a organização a partir da fonte que já tem em mãos (tenant ou perfil).
  // Uma tela chamando direto voltaria a criar atividade órfã sem ninguém perceber.
  const PERMITIDOS = [
    path.join('context', 'activities', 'ActivitiesContext.tsx'),
    path.join('lib', 'query', 'hooks', 'useActivitiesQuery.ts'),
    path.join('lib', 'query', 'hooks', 'useMoveDeal.ts'),
  ];
  const IGNORAR = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', 'playwright-report', 'test-results']);

  const varrer = (dir: string, achados: string[] = []): string[] => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORAR.has(entrada.name)) continue;
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(completo, achados);
      else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.test\.(ts|tsx)$/.test(entrada.name)) {
        if (fs.readFileSync(completo, 'utf8').includes('activitiesService.create(')) {
          achados.push(path.relative(RAIZ, completo));
        }
      }
    }
    return achados;
  };

  it('só os três pontos centrais chamam activitiesService.create', () => {
    const chamadores = varrer(RAIZ).sort();
    expect(chamadores).toEqual(PERMITIDOS.sort());
  });

  it('cada ponto central injeta a organização na chamada', () => {
    for (const relativo of PERMITIDOS) {
      const texto = fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
      expect(texto, `${relativo} precisa injetar a organização`).toMatch(/organizationId[,:]/);
    }
  });
});
