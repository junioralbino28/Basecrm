/**
 * @fileoverview As reuniões da IA dentro da agenda do CRM (Junior, 22/09/2026:
 * "essa tela não pode ficar vazia").
 *
 * A Aurora não marca em `appointments`: ela cria uma `activity` do tipo `MEETING`
 * (RPC `reserve_conversation_meeting`) e espelha no Google. Enquanto a agenda do
 * menu lia SÓ `appointments`, a reunião existia no Google e no card da conversa,
 * mas a tela ficava vazia — parecendo defeito.
 *
 * Aqui elas entram na mesma grade, em SOMENTE LEITURA. Remarcar e cancelar
 * continuam sendo pela conversa, que é quem fala com o lead e com o Google; deixar
 * remarcar por aqui criaria uma reunião fantasma (CRM mudado, Google e lead não).
 *
 * Segurança: cliente do USUÁRIO (RLS `activities_select_by_tenant` decide). Nada de
 * service-role — esta é tela de navegador.
 */
import { supabase } from './client';
import type { AppointmentDoDia } from './appointmentsLocal';

/** Prefixo no id para nunca colidir com o id de um `appointment` de verdade. */
export const PREFIXO_REUNIAO_IA = 'aurora:';

/** Quanto tempo a reunião ocupa na grade quando ninguém disse o contrário. */
export const DURACAO_PADRAO_REUNIAO_MIN = 40;

type LinhaDeAtividade = {
  id: string;
  organization_id: string | null;
  title: string | null;
  description: string | null;
  date: string;
  completed: boolean | null;
  contact_id: string | null;
  owner_id: string | null;
  contacts: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null;
};

function primeiro<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor;
}

export function mapearReuniaoDaIA(linha: LinhaDeAtividade): AppointmentDoDia {
  const contato = primeiro(linha.contacts);
  const fim = new Date(new Date(linha.date).getTime() + DURACAO_PADRAO_REUNIAO_MIN * 60_000);
  return {
    id: `${PREFIXO_REUNIAO_IA}${linha.id}`,
    organizationId: linha.organization_id ?? undefined,
    contactId: linha.contact_id ?? undefined,
    // Sem profissional: a reunião é do RESPONSÁVEL da conexão, não de alguém da equipe
    // cadastrada. A tela põe na coluna padrão quando não há equipe.
    professionalId: undefined,
    ownerId: linha.owner_id ?? undefined,
    startsAt: linha.date,
    endsAt: fim.toISOString(),
    // `completed` vira "compareceu": é o que a pessoa marcou como feito.
    status: linha.completed ? 'compareceu' : 'agendado',
    source: 'aurora',
    notes: linha.description ?? undefined,
    titulo: linha.title ?? undefined,
    contactName: contato?.name ?? null,
    contactPhone: contato?.phone ?? null,
    professionalName: null,
    somenteLeitura: true,
  };
}

const COLUNAS =
  'id, organization_id, title, description, date, completed, contact_id, owner_id, contacts(name, phone)';

export const reunioesDaIaService = {
  /** Reuniões da IA no intervalo [deIso, ateIso). Apagadas ficam de fora. */
  async listar(organizationId: string, deIso: string, ateIso: string) {
    if (!supabase) return { data: [] as AppointmentDoDia[], error: null };
    const { data, error } = await supabase
      .from('activities')
      .select(COLUNAS)
      .eq('organization_id', organizationId)
      .eq('type', 'MEETING')
      .is('deleted_at', null)
      .gte('date', deIso)
      .lt('date', ateIso)
      .order('date', { ascending: true });
    // Falha aqui NÃO derruba a agenda: as marcações normais continuam aparecendo.
    if (error) return { data: [] as AppointmentDoDia[], error };
    return { data: (data as unknown as LinhaDeAtividade[]).map(mapearReuniaoDaIA), error: null };
  },
};
