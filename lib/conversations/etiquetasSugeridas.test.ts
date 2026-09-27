import { describe, expect, it } from 'vitest';
import {
  buildAvailableTagsContext,
  normalizarNomeEtiqueta,
  resolverEtiquetasSugeridas,
  type TagCatalogEntry,
} from './etiquetasSugeridas';

const CATALOGO: TagCatalogEntry[] = [
  { id: 'id-quer', name: 'Quer agendar', normalizedName: 'quer agendar', categoryLabel: 'Interesse', categoryCardinality: 'multiple' },
  { id: 'id-verba', name: 'Sem verba agora', normalizedName: 'sem verba agora', categoryLabel: 'Interesse', categoryCardinality: 'multiple' },
  { id: 'id-pesq', name: 'Só pesquisando', normalizedName: 'so pesquisando', categoryLabel: 'Interesse', categoryCardinality: 'multiple' },
  { id: 'id-casa', name: 'CASA', normalizedName: 'casa', categoryLabel: 'Produto', categoryCardinality: 'single' },
];

describe('normalizarNomeEtiqueta', () => {
  it('ignora acento, caixa e espacos sobrando', () => {
    expect(normalizarNomeEtiqueta('  Só  Pesquisando ')).toBe('so pesquisando');
    expect(normalizarNomeEtiqueta('SEM VERBA AGORA')).toBe('sem verba agora');
  });
});

describe('resolverEtiquetasSugeridas', () => {
  it('casa nome exato e nome sem acento para o mesmo id', () => {
    expect(resolverEtiquetasSugeridas(CATALOGO, ['Só pesquisando'])).toEqual(['id-pesq']);
    expect(resolverEtiquetasSugeridas(CATALOGO, ['so pesquisando'])).toEqual(['id-pesq']);
  });

  it('descarta nome fora do catalogo sem derrubar os validos', () => {
    expect(resolverEtiquetasSugeridas(CATALOGO, ['inventada pela IA', 'Quer agendar'])).toEqual(['id-quer']);
  });

  it('deduplica sugestoes repetidas e aceita null/vazio', () => {
    expect(resolverEtiquetasSugeridas(CATALOGO, ['CASA', 'casa', 'Casa'])).toEqual(['id-casa']);
    expect(resolverEtiquetasSugeridas(CATALOGO, null)).toEqual([]);
    expect(resolverEtiquetasSugeridas(CATALOGO, [])).toEqual([]);
    expect(resolverEtiquetasSugeridas([], ['CASA'])).toEqual([]);
  });
});

describe('buildAvailableTagsContext', () => {
  it('agrupa por categoria e explica a cardinalidade em portugues', () => {
    const contexto = buildAvailableTagsContext(CATALOGO);
    expect(contexto).toContain('Interesse (pode acumular): Quer agendar | Sem verba agora | Só pesquisando');
    expect(contexto).toContain('Produto (no maximo UMA por negocio, a nova substitui a anterior): CASA');
  });

  it('sem catalogo, manda devolver null sempre', () => {
    expect(buildAvailableTagsContext([])).toContain('devolva suggestedTags sempre null');
  });
});
