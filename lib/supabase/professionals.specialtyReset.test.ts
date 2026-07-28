import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('./client', () => ({
  supabase: {
    from: (...a: unknown[]) => fromMock(...a),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  },
}));

import { professionalsService } from './professionals';

/**
 * TIRAR E RECOLOCAR A ESPECIALIDADE VOLTA AO PADRÃO.
 *
 * Junior, 2026-07-27: *"quando na aba equipe eu tiro algum procedimento de algum
 * profissional, ele só volta se eu adicionar manualmente; seria interessante que
 * tirando a especialidade, salvando e novamente adicionando, ela volte."*
 *
 * A exceção da pessoa (`professional_product_overrides`) vive independente da
 * especialidade — então, sem esta limpeza, remover e recolocar a especialidade
 * deixaria os procedimentos DESLIGADOS, que é exatamente a queixa dele.
 */

const PRO = '11111111-1111-4111-8111-111111111111';
const ESP_NOVA = '22222222-2222-4222-8222-222222222222';

type Chain = Record<string, unknown>;

/** Chain encadeável e "thenable" — espelha `.select().eq().in()` + `await`. */
function chain(data: unknown, error: unknown = null): Chain {
  const c: Chain = {};
  const self = () => c;
  for (const m of ['select', 'eq', 'in', 'insert', 'delete', 'update', 'upsert', 'order']) {
    c[m] = vi.fn(self);
  }
  c.single = vi.fn(async () => ({ data, error }));
  c.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => resolve({ data, error });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('professionalsService.update — especialidade que volta limpa as exceções', () => {
  it('apaga as exceções dos procedimentos da especialidade que ENTROU', async () => {
    const chamadas: string[] = [];
    const overridesDelete = chain(null);

    fromMock.mockImplementation((tabela: string) => {
      chamadas.push(tabela);
      switch (tabela) {
        // A pessoa NÃO tinha esta especialidade → ela está entrando.
        case 'professional_specialties':
          return chain([]);
        case 'specialty_products':
          return chain([{ product_id: 'prod-A' }, { product_id: 'prod-B' }]);
        case 'professional_product_overrides':
          return overridesDelete;
        case 'specialties':
          return chain([{ id: ESP_NOVA, name: 'Ortodontia' }]);
        default:
          return chain({ organization_id: 'org-1' });
      }
    });

    const { error } = await professionalsService.update(PRO, { specialtyIds: [ESP_NOVA] });

    expect(error).toBeNull();
    expect(chamadas).toContain('professional_product_overrides');
    // Só os procedimentos DAQUELA especialidade — não varre as exceções todas.
    expect(overridesDelete.in).toHaveBeenCalledWith('product_id', ['prod-A', 'prod-B']);
  });

  it('especialidade que JÁ existia não mexe nas exceções', async () => {
    const chamadas: string[] = [];
    fromMock.mockImplementation((tabela: string) => {
      chamadas.push(tabela);
      switch (tabela) {
        // Já estava lá → nada entrou, nada a limpar.
        case 'professional_specialties':
          return chain([{ specialty_id: ESP_NOVA }]);
        case 'specialties':
          return chain([{ id: ESP_NOVA, name: 'Ortodontia' }]);
        default:
          return chain({ organization_id: 'org-1' });
      }
    });

    await professionalsService.update(PRO, { specialtyIds: [ESP_NOVA] });

    expect(chamadas).not.toContain('professional_product_overrides');
    expect(chamadas).not.toContain('specialty_products');
  });
});
