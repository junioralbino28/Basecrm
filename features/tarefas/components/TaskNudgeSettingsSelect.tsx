import React from 'react';
import { BellRing } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  useTaskNudgeInterval,
  useUpdateTaskNudgeInterval,
} from '@/lib/query/hooks/useOrganizationSettingsQuery';
import { canManageClinicSettings } from '@/lib/auth/scope';
import { taskNudgeIntervalSchema } from '@/lib/validations/schemas';
import type { TaskNudgeInterval } from '@/lib/supabase';

/**
 * Select "aviso automático" do header da tela Tarefas (N3 — mockup).
 *
 * Configura `organization_settings.task_nudge_interval_minutes`
 * (null = desligado · 15/30/60). Gate por ROLE REAL
 * (canManageClinicSettings — clinic_admin/agency_admin): staff não vê o
 * controle e, mesmo que tentasse, a RLS can_configure barra no banco.
 * NUNCA gate por classe responsiva.
 */
export const TaskNudgeSettingsSelect: React.FC = () => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { data: interval = null, isLoading } = useTaskNudgeInterval();
  const updateMutation = useUpdateTaskNudgeInterval();

  if (!canManageClinicSettings(profile?.role)) return null;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // zod no "submit" do controle — espelha o CHECK 15/30/60 do banco.
    const parsed = taskNudgeIntervalSchema.safeParse(e.target.value);
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Intervalo do aviso inválido', 'error');
      return;
    }

    updateMutation.mutate(parsed.data as TaskNudgeInterval, {
      onSuccess: () => showToast('Aviso automático salvo', 'success'),
      onError: (error: Error) => {
        showToast(`Erro ao salvar aviso automático: ${error.message}`, 'error');
      },
    });
  };

  return (
    <label className="flex items-center gap-2 text-[11px] text-faint">
      <BellRing size={14} className="text-gold-600" aria-hidden="true" />
      <span>aviso automático</span>
      <select
        value={interval === null ? '' : String(interval)}
        onChange={handleChange}
        disabled={isLoading || updateMutation.isPending}
        className="h-8 rounded-lg bg-surface border border-line text-xs font-medium text-ink px-2 focus:outline-none focus:ring-2 focus:ring-brand-500/25 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <option value="15">a cada 15 min</option>
        <option value="30">a cada 30 min</option>
        <option value="60">a cada 1 h</option>
        <option value="">desligado</option>
      </select>
    </label>
  );
};
