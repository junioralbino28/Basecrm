/**
 * @fileoverview Etiquetas sugeridas pela IA do atendimento (decisao de 27/09).
 *
 * Contrato:
 * - A IA APONTA etiquetas pelo nome, restrita ao catalogo ativo da organizacao
 *   (o prompt recebe a lista pelo placeholder {{availableTagsContext}}).
 * - Quem APLICA e o servidor, pela RPC `assign_deal_tag_system` (provenance
 *   'ai'); nome fora do catalogo e descartado em silencio — a IA nunca cria
 *   etiqueta nem escreve direto na tabela.
 * - O casamento de nome ignora acento e caixa (normalizacao NFD sem marcas):
 *   busca acentuada que devolve vazio parece ausencia do registro (24/09).
 * - Falha ao aplicar etiqueta NUNCA derruba a resposta da conversa.
 */

type AdminLike = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type TagCatalogEntry = {
  id: string;
  name: string;
  normalizedName: string | null;
  categoryLabel: string;
  categoryCardinality: 'single' | 'multiple';
};

/** NFD sem marcas + minusculas + espacos colapsados: "Só Pesquisando " casa "so pesquisando". */
export function normalizarNomeEtiqueta(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Catalogo ativo do tenant (tags com categoria ativa), para o prompt e a validacao. */
export async function loadTagCatalog(
  admin: AdminLike,
  organizationId: string,
): Promise<TagCatalogEntry[]> {
  const [categorias, tags] = await Promise.all([
    admin
      .from('tag_categories')
      .select('id, label, cardinality')
      .eq('organization_id', organizationId)
      .is('archived_at', null),
    admin
      .from('tags')
      .select('id, name, normalized_name, category_id')
      .eq('organization_id', organizationId)
      .is('archived_at', null)
      .not('category_id', 'is', null),
  ]);
  if (categorias.error || tags.error) {
    console.warn('[Conversation AI] Failed to load tag catalog', {
      organizationId,
      error: categorias.error?.message || tags.error?.message,
    });
    return [];
  }
  const porCategoria = new Map<string, { label: string; cardinality: 'single' | 'multiple' }>(
    ((categorias.data || []) as Array<{ id: string; label: string; cardinality: string | null }>).map((c) => [
      c.id,
      { label: c.label, cardinality: c.cardinality === 'single' ? 'single' : 'multiple' },
    ]),
  );
  return ((tags.data || []) as Array<{ id: string; name: string; normalized_name: string | null; category_id: string }>)
    .filter((t) => porCategoria.has(t.category_id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      normalizedName: t.normalized_name,
      categoryLabel: porCategoria.get(t.category_id)!.label,
      categoryCardinality: porCategoria.get(t.category_id)!.cardinality,
    }));
}

/** Bloco do prompt: uma linha por categoria, com a regra de cardinalidade dita em portugues. */
export function buildAvailableTagsContext(catalog: TagCatalogEntry[]): string {
  if (!catalog.length) {
    return 'Nenhuma etiqueta disponivel nesta organizacao: devolva suggestedTags sempre null.';
  }
  const porCategoria = new Map<string, { cardinality: 'single' | 'multiple'; nomes: string[] }>();
  for (const tag of catalog) {
    const atual = porCategoria.get(tag.categoryLabel) ?? { cardinality: tag.categoryCardinality, nomes: [] };
    atual.nomes.push(tag.name);
    porCategoria.set(tag.categoryLabel, atual);
  }
  const linhas = [...porCategoria.entries()].map(([label, info]) => {
    const regra = info.cardinality === 'single' ? 'no maximo UMA por negocio, a nova substitui a anterior' : 'pode acumular';
    return `- ${label} (${regra}): ${info.nomes.join(' | ')}`;
  });
  return linhas.join('\n');
}

/** Resolve nomes sugeridos para ids do catalogo; fora do catalogo e descartado. */
export function resolverEtiquetasSugeridas(
  catalog: TagCatalogEntry[],
  sugeridas: string[] | null | undefined,
): string[] {
  if (!sugeridas?.length || !catalog.length) return [];
  const porNome = new Map<string, string>();
  for (const tag of catalog) {
    porNome.set(normalizarNomeEtiqueta(tag.name), tag.id);
    if (tag.normalizedName) porNome.set(normalizarNomeEtiqueta(tag.normalizedName), tag.id);
  }
  const ids: string[] = [];
  for (const nome of sugeridas) {
    if (typeof nome !== 'string') continue;
    const id = porNome.get(normalizarNomeEtiqueta(nome));
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Aplica as etiquetas resolvidas no negocio da conversa (provenance 'ai').
 * O gatilho `trg_dispatch_tag_added_enrollment` do banco inscreve o negocio nas
 * automacoes publicadas daquela etiqueta — e por ai que o lead anda no funil.
 */
export async function aplicarEtiquetasSugeridas(input: {
  admin: AdminLike;
  organizationId: string;
  dealId: string;
  tagIds: string[];
}): Promise<{ aplicadas: number }> {
  let aplicadas = 0;
  for (const tagId of input.tagIds) {
    try {
      const resultado = await input.admin.rpc('assign_deal_tag_system', {
        p_organization_id: input.organizationId,
        p_deal_id: input.dealId,
        p_tag_id: tagId,
        p_provenance: 'ai',
      });
      if (resultado.error) {
        console.warn('[Conversation AI] Failed to apply suggested tag', {
          organizationId: input.organizationId,
          dealId: input.dealId,
          tagId,
          error: resultado.error.message,
        });
      } else {
        aplicadas += 1;
      }
    } catch (error) {
      console.warn('[Conversation AI] Failed to apply suggested tag', {
        organizationId: input.organizationId,
        dealId: input.dealId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { aplicadas };
}
