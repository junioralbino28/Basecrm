/**
 * @fileoverview Serviço Supabase para registro de atendimentos (clínico-financeiro).
 *
 * ## Insight travado
 * Faturamento conta SÓ quando `recebido = true`. Ao marcar recebido, o service
 * carimba `paid_at = now()`. Pagamento = sinal de compromisso.
 *
 * ## Desconto (adendo 2026-06-10)
 * A planilha real do Adel tem a coluna `desconto` (total = valor − desconto).
 * O valor líquido NÃO é persistido — relatórios derivam de valor − desconto.
 *
 * ## Segurança Multi-Tenant
 * O `organization_id` e o `owner_id` são carimbados no service no insert; a RLS
 * (can_operate_organization) é o gate real. Nunca confiar no orgId do client.
 *
 * @module lib/supabase/atendimentos
 */

import { supabase } from './client';
import { Atendimento } from '@/types';
import { sanitizeUUID, normalizeCardBrand } from './utils';

const SELECT_COLUMNS =
  'id, organization_id, contact_id, deal_id, professional_id, product_id, procedimento, valor, desconto, payment_method, card_brand, installments, recebido, paid_at, performed_at, owner_id, created_at, updated_at';

export interface DbAtendimento {
  id: string;
  organization_id: string;
  contact_id: string | null;
  deal_id: string | null;
  professional_id: string | null;
  product_id: string | null;
  procedimento: string;
  valor: number;
  desconto: number;
  payment_method: string | null;
  card_brand: string | null;
  installments: number;
  recebido: boolean;
  paid_at: string | null;
  performed_at: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

function transformAtendimento(db: DbAtendimento): Atendimento {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    contactId: db.contact_id || undefined,
    dealId: db.deal_id || undefined,
    professionalId: db.professional_id || undefined,
    productId: db.product_id || undefined,
    procedimento: db.procedimento,
    valor: Number(db.valor ?? 0),
    desconto: Number(db.desconto ?? 0),
    paymentMethod: db.payment_method || undefined,
    cardBrand: db.card_brand || undefined,
    installments: Number(db.installments ?? 1),
    recebido: db.recebido ?? false,
    paidAt: db.paid_at || undefined,
    performedAt: db.performed_at,
  };
}

/**
 * Monta o payload de insert carimbando org + owner e derivando paid_at de recebido.
 */
function atendimentoToInsert(
  input: Omit<Atendimento, 'id'>,
  organizationId: string | null,
  ownerId: string | null
): Record<string, unknown> {
  const recebido = input.recebido ?? false;
  return {
    organization_id: sanitizeUUID(organizationId),
    owner_id: sanitizeUUID(ownerId),
    contact_id: sanitizeUUID(input.contactId),
    deal_id: sanitizeUUID(input.dealId),
    professional_id: sanitizeUUID(input.professionalId),
    product_id: sanitizeUUID(input.productId),
    procedimento: input.procedimento,
    valor: input.valor ?? 0,
    desconto: input.desconto ?? 0,
    payment_method: input.paymentMethod || null,
    // HIGH-2: bandeira normalizada (lower+trim) p/ casar com payment_method_fees.
    card_brand: normalizeCardBrand(input.cardBrand),
    installments: input.installments ?? 1,
    recebido,
    paid_at: recebido ? (input.paidAt || new Date().toISOString()) : null,
    performed_at: input.performedAt || new Date().toISOString(),
  };
}

export const atendimentosService = {
  /**
   * Busca todos os atendimentos do tenant (mais recentes primeiro).
   */
  async getAll(organizationId?: string | null): Promise<{ data: Atendimento[] | null; error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { data: null, error: new Error('Supabase não configurado') };

      let query = sb.from('atendimentos').select(SELECT_COLUMNS);

      const normalizedOrganizationId = sanitizeUUID(organizationId);
      if (normalizedOrganizationId) {
        query = query.eq('organization_id', normalizedOrganizationId);
      }

      const { data, error } = await query.order('performed_at', { ascending: false });

      if (error) return { data: null, error };
      return { data: (data || []).map(a => transformAtendimento(a as unknown as DbAtendimento)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria um atendimento. org+owner carimbados aqui; RLS valida via WITH CHECK.
   */
  async create(
    atendimento: Omit<Atendimento, 'id'>,
    organizationId?: string | null
  ): Promise<{ data: Atendimento | null; error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await sb.auth.getUser();
      const insertData = atendimentoToInsert(atendimento, organizationId ?? null, user?.id ?? null);

      const { data, error } = await sb
        .from('atendimentos')
        .insert(insertData)
        .select(SELECT_COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformAtendimento(data as unknown as DbAtendimento), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Atualiza um atendimento. Se `recebido` mudar, ajusta `paid_at` coerentemente.
   */
  async update(id: string, updates: Partial<Atendimento>): Promise<{ error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { error: new Error('Supabase não configurado') };

      const payload: Record<string, unknown> = {};
      if (updates.contactId !== undefined) payload.contact_id = sanitizeUUID(updates.contactId);
      if (updates.dealId !== undefined) payload.deal_id = sanitizeUUID(updates.dealId);
      if (updates.professionalId !== undefined) payload.professional_id = sanitizeUUID(updates.professionalId);
      if (updates.productId !== undefined) payload.product_id = sanitizeUUID(updates.productId);
      if (updates.procedimento !== undefined) payload.procedimento = updates.procedimento;
      if (updates.valor !== undefined) payload.valor = updates.valor;
      if (updates.desconto !== undefined) payload.desconto = updates.desconto;
      if (updates.paymentMethod !== undefined) payload.payment_method = updates.paymentMethod || null;
      if (updates.cardBrand !== undefined) payload.card_brand = normalizeCardBrand(updates.cardBrand);
      if (updates.installments !== undefined) payload.installments = updates.installments;
      if (updates.performedAt !== undefined) payload.performed_at = updates.performedAt;
      if (updates.recebido !== undefined) {
        payload.recebido = updates.recebido;
        payload.paid_at = updates.recebido ? (updates.paidAt || new Date().toISOString()) : null;
      }

      const { error } = await sb.from('atendimentos').update(payload).eq('id', sanitizeUUID(id));
      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /**
   * Exclui um atendimento.
   */
  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { error: new Error('Supabase não configurado') };

      const { error } = await sb.from('atendimentos').delete().eq('id', sanitizeUUID(id));
      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },
};

// Exports internos só para teste de transform (não usar na app).
export const __transformAtendimento = transformAtendimento;
export const __atendimentoToInsert = atendimentoToInsert;
