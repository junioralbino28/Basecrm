import { describe, expect, it } from 'vitest';
import { readLeadEntryRoutes, resolveLeadEntryRoute } from './leadEntryRouting';

const BOARD = '1b755a72-90ac-4490-b9ac-f0dc13569687';
const TAG = '1e6b7ea4-1b52-49df-aa25-021a4e8d8451';

describe('readLeadEntryRoutes — leitura tolerante da configuracao', () => {
  it('sem configuracao, configuracao nula ou tipo errado: nenhuma rota (fluxo de sempre)', () => {
    expect(readLeadEntryRoutes(null)).toEqual([]);
    expect(readLeadEntryRoutes({})).toEqual([]);
    expect(readLeadEntryRoutes({ leadEntryRoutes: 'texto' })).toEqual([]);
    expect(readLeadEntryRoutes({ leadEntryRoutes: { sourceId: 'x' } })).toEqual([]);
  });

  it('regra completa entra; tagId e opcional', () => {
    const rotas = readLeadEntryRoutes({
      leadEntryRoutes: [
        { sourceId: '12034567890', boardId: BOARD, tagId: TAG },
        { sourceId: '999', boardId: BOARD },
      ],
    });
    expect(rotas).toEqual([
      { sourceId: '12034567890', boardId: BOARD, tagId: TAG },
      { sourceId: '999', boardId: BOARD, tagId: null },
    ]);
  });

  it('regra malformada e descartada sem derrubar as validas', () => {
    const rotas = readLeadEntryRoutes({
      leadEntryRoutes: [
        null,
        'texto',
        { sourceId: '', boardId: BOARD },
        { sourceId: '123', boardId: 'nao-e-uuid' },
        { sourceId: '456', boardId: BOARD, tagId: 'nao-e-uuid' },
        { sourceId: '789', boardId: BOARD, tagId: TAG },
      ],
    });
    // tagId invalida vira null (a rota de funil ainda vale); boardId invalido descarta a rota.
    expect(rotas).toEqual([
      { sourceId: '456', boardId: BOARD, tagId: null },
      { sourceId: '789', boardId: BOARD, tagId: TAG },
    ]);
  });
});

describe('resolveLeadEntryRoute — casamento pelo anuncio de origem', () => {
  const rotas = readLeadEntryRoutes({
    leadEntryRoutes: [{ sourceId: '12034567890', boardId: BOARD, tagId: TAG }],
  });

  it('casa por id exato do anuncio', () => {
    expect(resolveLeadEntryRoute(rotas, '12034567890')?.boardId).toBe(BOARD);
  });

  it('sem clique de anuncio, id vazio ou sem regra casando: null (fluxo de sempre)', () => {
    expect(resolveLeadEntryRoute(rotas, null)).toBeNull();
    expect(resolveLeadEntryRoute(rotas, '')).toBeNull();
    expect(resolveLeadEntryRoute(rotas, 'outro-anuncio')).toBeNull();
    expect(resolveLeadEntryRoute([], '12034567890')).toBeNull();
  });
});
