/**
 * @fileoverview Quais procedimentos cabem em cada especialidade, e as exceções
 * de cada pessoa sobre isso.
 *
 * Pedido do Junior (2026-07-27): marcar uma vez, na especialidade, quais
 * procedimentos ela cobre; a ficha de quem tem essa especialidade já abre com
 * eles ligados, e dá pra ligar/desligar um a um.
 *
 * A regra é **derivada + exceções** (a mesma que vive em
 * `professional_does_product` no banco):
 *   - existe exceção → ela manda;
 *   - senão → cabe em alguma especialidade da pessoa?
 *
 * Assim, procedimento novo marcado numa especialidade vale pra todo mundo que
 * tem aquela especialidade, sem reabrir ficha por ficha.
 */
import { supabase } from './client';

export type SpecialtyProductLink = { specialtyId: string; productId: string };
export type ProfessionalProductOverride = { productId: string; enabled: boolean };

async function currentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles').select('organization_id').eq('id', user.id).single();
  return (data?.organization_id as string) || null;
}

export const specialtyProductsService = {
  /** Todos os vínculos da clínica — a tela agrupa por especialidade. */
  async list(): Promise<{ data: SpecialtyProductLink[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('specialty_products')
        .select('specialty_id, product_id');
      if (error) return { data: [], error };
      return {
        data: (data || []).map((r) => ({
          specialtyId: String((r as { specialty_id: string }).specialty_id),
          productId: String((r as { product_id: string }).product_id),
        })),
        error: null,
      };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  /** Liga/desliga um procedimento numa especialidade. */
  async set(
    specialtyId: string,
    productId: string,
    marcado: boolean,
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      if (!marcado) {
        const { error } = await supabase
          .from('specialty_products')
          .delete()
          .eq('specialty_id', specialtyId)
          .eq('product_id', productId);
        return { error: error ?? null };
      }
      const orgId = await currentOrganizationId();
      const { error } = await supabase
        .from('specialty_products')
        .insert({ specialty_id: specialtyId, product_id: productId, organization_id: orgId });
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};

export const professionalProductsService = {
  /** Exceções de uma pessoa. Sem linha = vale o que a especialidade diz. */
  async listOverrides(
    professionalId: string,
  ): Promise<{ data: ProfessionalProductOverride[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('professional_product_overrides')
        .select('product_id, enabled')
        .eq('professional_id', professionalId);
      if (error) return { data: [], error };
      return {
        data: (data || []).map((r) => ({
          productId: String((r as { product_id: string }).product_id),
          enabled: Boolean((r as { enabled: boolean }).enabled),
        })),
        error: null,
      };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  /**
   * Grava o que a pessoa faz. Quando a escolha volta a coincidir com o que a
   * especialidade já diz, a exceção é APAGADA em vez de gravada — senão o
   * cadastro acumularia linhas que não mudam nada e, pior, congelaria a pessoa
   * fora de mudanças futuras da especialidade.
   */
  async set(
    professionalId: string,
    productId: string,
    faz: boolean,
    vemDaEspecialidade: boolean,
  ): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      if (faz === vemDaEspecialidade) {
        const { error } = await supabase
          .from('professional_product_overrides')
          .delete()
          .eq('professional_id', professionalId)
          .eq('product_id', productId);
        return { error: error ?? null };
      }
      const orgId = await currentOrganizationId();
      const { error } = await supabase
        .from('professional_product_overrides')
        .upsert(
          {
            professional_id: professionalId,
            product_id: productId,
            enabled: faz,
            organization_id: orgId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'professional_id,product_id' },
        );
      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
