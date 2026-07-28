/**
 * @fileoverview Agenda NOSSA — fatia 1 (Junior, 28/07/2026: "a agenda vai ser
 * nossa, ela vai preencher no clinicorp").
 *
 * As marcações nascem e vivem NESTA tabela (`appointments`, que já existia como
 * cache do espelho Clinicorp). Nesta fatia NADA toca o Clinicorp: `source` das
 * marcações criadas aqui é 'manual', e as linhas 'clinicorp_api' (cache antigo
 * ou, no futuro, a VOLTA do espelho) convivem lado a lado — o par
 * `org+source+external_id` é o que casa os dois mundos nas fatias 2/3.
 *
 * Segurança: cliente do USUÁRIO (RLS decide) — ver exige acesso à clínica,
 * mexer exige poder de operação. Nada de service-role aqui.
 */
import { supabase } from './client';
import type { Appointment, AppointmentStatus } from '@/types';

export type AppointmentDoDia = Appointment & {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  professionalName: string | null;
};

type LinhaDoBanco = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  professional_id: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  source: string;
  external_id: string | null;
  notes: string | null;
  contacts: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
  professionals: { name: string | null } | { name: string | null }[] | null;
};

/** PostgREST devolve o embed como objeto OU array conforme a FK — normaliza. */
function primeiro<T>(valor: T | T[] | null): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor;
}

function mapear(linha: LinhaDoBanco): AppointmentDoDia {
  const contato = primeiro(linha.contacts);
  const profissional = primeiro(linha.professionals);
  return {
    id: linha.id,
    organizationId: linha.organization_id,
    contactId: linha.contact_id ?? undefined,
    professionalId: linha.professional_id ?? undefined,
    startsAt: linha.starts_at,
    endsAt: linha.ends_at ?? undefined,
    status: linha.status as AppointmentStatus,
    source: (linha.source === 'clinicorp_api' ? 'clinicorp_api' : 'manual'),
    externalId: linha.external_id ?? undefined,
    notes: linha.notes ?? undefined,
    contactName: contato?.name ?? null,
    contactPhone: contato?.phone ?? null,
    professionalName: profissional?.name ?? null,
  };
}

const COLUNAS =
  'id, organization_id, contact_id, professional_id, starts_at, ends_at, status, source, external_id, notes, ' +
  'contacts(name, phone), professionals(name)';

export const appointmentsLocalService = {
  /** Marcações do intervalo [deIso, ateIso) — canceladas incluídas (a tela decide). */
  async listar(organizationId: string, deIso: string, ateIso: string) {
    if (!supabase) return { data: [] as AppointmentDoDia[], error: new Error('Supabase não configurado') };
    const { data, error } = await supabase
      .from('appointments')
      .select(COLUNAS)
      .eq('organization_id', organizationId)
      .gte('starts_at', deIso)
      .lt('starts_at', ateIso)
      .order('starts_at', { ascending: true });
    if (error) return { data: [] as AppointmentDoDia[], error };
    return { data: (data as unknown as LinhaDoBanco[]).map(mapear), error: null };
  },

  async criar(params: {
    organizationId: string;
    contactId: string;
    professionalId: string;
    startsAtIso: string;
    endsAtIso: string;
    notes?: string;
  }) {
    if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
    const { data, error } = await supabase
      .from('appointments')
      .insert({
        organization_id: params.organizationId,
        contact_id: params.contactId,
        professional_id: params.professionalId,
        starts_at: params.startsAtIso,
        ends_at: params.endsAtIso,
        status: 'agendado',
        source: 'manual',
        notes: params.notes?.trim() || null,
      })
      .select('id')
      .single();
    return { data, error };
  },

  /** Remarcar muda horário/dentista e carimba o status 'remarcado'. */
  async remarcar(id: string, params: {
    startsAtIso: string;
    endsAtIso: string;
    professionalId?: string;
    notes?: string | null;
  }) {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const { error } = await supabase
      .from('appointments')
      .update({
        starts_at: params.startsAtIso,
        ends_at: params.endsAtIso,
        ...(params.professionalId ? { professional_id: params.professionalId } : {}),
        ...(params.notes !== undefined ? { notes: params.notes?.trim() || null } : {}),
        status: 'remarcado',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return { error };
  },

  async mudarStatus(id: string, status: AppointmentStatus) {
    if (!supabase) return { error: new Error('Supabase não configurado') };
    const { error } = await supabase
      .from('appointments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    return { error };
  },
};
