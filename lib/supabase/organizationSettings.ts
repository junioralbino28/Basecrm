/**
 * @fileoverview Serviço Supabase para configurações por organização (N3).
 *
 * Hoje cobre SÓ o nudge de tarefas: `task_nudge_interval_minutes` em
 * `organization_settings` (linha criada por trigger no provisionamento da org).
 * null = desligado · 15/30/60 = aviso a cada N minutos.
 *
 * ## Segurança Multi-Tenant
 * RLS do core: SELECT = can_access_organization (a recepção LÊ o intervalo pro
 * pop-up) e mutação = can_configure_organization (só quem configura a org muda
 * — o gate real é o banco, a UI só esconde o select).
 *
 * @module lib/supabase/organizationSettings
 */

import { supabase } from './client';
import { sanitizeUUID } from './utils';

/** Intervalo do nudge: null = desligado; 15/30/60 minutos (CHECK no banco). */
export type TaskNudgeInterval = 15 | 30 | 60 | null;

export const organizationSettingsService = {
  /**
   * Lê o intervalo do nudge da organização (null = desligado/sem linha).
   */
  async getTaskNudgeInterval(
    organizationId?: string | null
  ): Promise<{ data: TaskNudgeInterval; error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { data: null, error: new Error('Supabase não configurado') };

      const normalizedOrganizationId = sanitizeUUID(organizationId);
      if (!normalizedOrganizationId) {
        return { data: null, error: new Error('Organização não informada') };
      }

      const { data, error } = await sb
        .from('organization_settings')
        .select('task_nudge_interval_minutes')
        .eq('organization_id', normalizedOrganizationId)
        .maybeSingle();

      if (error) return { data: null, error };
      const value = data?.task_nudge_interval_minutes;
      return {
        data: value === 15 || value === 30 || value === 60 ? value : null,
        error: null,
      };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Atualiza o intervalo do nudge (null desliga). Só envia o campo editado —
   * NUNCA toca as outras colunas de organization_settings (lição F4).
   * A RLS can_configure barra staff; o CHECK barra valor fora de 15/30/60.
   */
  async updateTaskNudgeInterval(
    organizationId: string | null | undefined,
    minutes: TaskNudgeInterval
  ): Promise<{ error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { error: new Error('Supabase não configurado') };

      const normalizedOrganizationId = sanitizeUUID(organizationId);
      if (!normalizedOrganizationId) {
        return { error: new Error('Organização não informada') };
      }

      const { data, error } = await sb
        .from('organization_settings')
        .update({ task_nudge_interval_minutes: minutes })
        .eq('organization_id', normalizedOrganizationId)
        .select('organization_id');

      if (error) return { error };
      // RLS pode transformar o update em no-op silencioso (0 linhas) — para o
      // operador isso É um erro: a config não foi salva.
      if (!data || data.length === 0) {
        return { error: new Error('Sem permissão para configurar o aviso desta organização') };
      }
      return { error: null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
