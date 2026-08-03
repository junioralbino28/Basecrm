/**
 * @fileoverview Serviço Supabase para profissionais (dentistas) da clínica.
 *
 * Observação:
 * - Camada clínico-financeira: tabela dedicada `professionals`.
 * - Só clinic_admin/agency_admin muta (RLS can_configure); clinic_staff lê.
 * - organization_id + owner_id são STAMPADOS no insert (padrão productsService);
 *   a RLS WITH CHECK valida — nunca confiar no orgId do client como segurança.
 */

import { supabase } from './client';
import { Professional } from '@/types';
import { sanitizeUUID } from './utils';

type DbProfessional = {
  id: string;
  organization_id: string | null;
  name: string;
  specialty: string | null;
  role: string | null;
  pay_type: string | null;
  fixed_amount: number | string | null;
  active: boolean | null;
  external_id: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  professional_specialties?: Array<{
    specialty_id: string;
    // O PostgREST devolve OBJETO no vínculo um-para-um, mas o tipo gerado diz
    // array. Aceitamos as duas formas e normalizamos — o dado real manda.
    specialties: { name: string } | Array<{ name: string }> | null;
  }> | null;
};

function nomeDaEspecialidade(v: { name: string } | Array<{ name: string }> | null): string {
  if (!v) return '';
  return Array.isArray(v) ? (v[0]?.name || '') : v.name;
}

// Uma pessoa faz vários procedimentos, então tem várias especialidades (Junior,
// 2026-07-27). A coluna `specialty` virou espelho legado de UMA delas — a lista
// de verdade vem da tabela de ligação, nunca de uma string com vírgulas (foi
// assim que o catálogo nasceu sujo).
const SELECT_COLUMNS =
  'id, organization_id, name, specialty, role, pay_type, fixed_amount, active, external_id, owner_id, created_at, updated_at, professional_specialties(specialty_id, specialties(name))';

function transformProfessional(db: DbProfessional): Professional {
  const vinculos = (db.professional_specialties || [])
    .map((v) => ({ id: v.specialty_id, name: nomeDaEspecialidade(v.specialties) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    specialty: db.specialty || undefined,
    specialtyIds: vinculos.map((v) => v.id),
    specialtyNames: vinculos.map((v) => v.name).filter(Boolean),
    role: db.role || undefined,
    payType: (db.pay_type as Professional['payType']) || 'commission',
    fixedAmount: Number(db.fixed_amount ?? 0),
    active: db.active ?? true,
    externalId: db.external_id || undefined,
    ownerId: db.owner_id || undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

/**
 * Deixa as ligações da pessoa iguais à lista escolhida na tela e devolve o
 * ESPELHO LEGADO (`professionals.specialty`) — a primeira especialidade em ordem
 * alfabética, ou `null` se não houver nenhuma.
 *
 * O espelho existe pela lição de `commission_rules.amount` (24/07): coluna nova
 * sem par legado deixa quem ainda lê a antiga vendo dado errado em silêncio.
 *
 * TIRAR E RECOLOCAR A ESPECIALIDADE VOLTA AO PADRÃO (Junior, 2026-07-27:
 * "quando eu tiro algum procedimento de algum profissional, ele só volta se eu
 * adicionar manualmente; tirando a especialidade e adicionando de novo, que ela
 * volte"). Ao ADICIONAR uma especialidade, as exceções da pessoa nos
 * procedimentos daquela especialidade são apagadas — é o "recomeçar do zero"
 * que ele espera.
 *
 * AO REMOVER, A SIMETRIA (Junior, 2026-07-28: "remove só as da especialidade
 * removida e mantém as outras manuais"): as exceções nos procedimentos da
 * especialidade que SAI também são apagadas — MENOS as de procedimento que
 * continua coberto por outra especialidade da pessoa (essas marcações
 * pertencem ao contexto que ficou, não ao que saiu).
 */
async function syncSpecialtiesLegacy(
  professionalId: string,
  organizationId: string,
  specialtyIds: string[],
): Promise<{ mirror: string | null; error: Error | null }> {
  if (!supabase) return { mirror: null, error: new Error('Supabase não configurado') };

  const ids = [...new Set(specialtyIds.map((id) => sanitizeUUID(id)).filter(Boolean))] as string[];
  const proId = sanitizeUUID(professionalId);
  const orgId = sanitizeUUID(organizationId);
  if (!proId || !orgId) {
    return { mirror: null, error: new Error('Organização ou profissional inválido') };
  }

  // Lê o que já existe pra saber o que ENTROU — sem isso não dá pra distinguir
  // "especialidade nova" de "especialidade que já estava lá".
  const { data: atuais, error: atuaisError } = await supabase
    .from('professional_specialties')
    .select('specialty_id')
    .eq('professional_id', proId)
    .eq('organization_id', orgId);
  if (atuaisError) return { mirror: null, error: atuaisError };

  const antes = new Set((atuais || []).map((r) => String((r as { specialty_id: string }).specialty_id)));
  const entraram = ids.filter((id) => !antes.has(id));
  const sairam = [...antes].filter((id) => !ids.includes(id));

  if (sairam.length > 0) {
    const { error } = await supabase
      .from('professional_specialties')
      .delete()
      .eq('professional_id', proId)
      .eq('organization_id', orgId)
      .in('specialty_id', sairam);
    if (error) return { mirror: null, error };

    // Especialidade que SAI leva embora as exceções nos procedimentos DELA —
    // menos as de procedimento ainda coberto por especialidade que FICOU
    // (um procedimento pode caber em várias; a marcação pertence ao contexto
    // que continua, não ao que saiu).
    const { data: procsDaQueSaiu } = await supabase
      .from('specialty_products')
      .select('product_id')
      .eq('organization_id', orgId)
      .in('specialty_id', sairam);
    const candidatos = [...new Set((procsDaQueSaiu || [])
      .map((r) => String((r as { product_id: string }).product_id)))];

    if (candidatos.length > 0) {
      let cobertos = new Set<string>();
      if (ids.length > 0) {
        const { data: procsQueFicam } = await supabase
          .from('specialty_products')
          .select('product_id')
          .eq('organization_id', orgId)
          .in('specialty_id', ids);
        cobertos = new Set((procsQueFicam || [])
          .map((r) => String((r as { product_id: string }).product_id)));
      }
      const alvosDaSaida = candidatos.filter((id) => !cobertos.has(id));
      if (alvosDaSaida.length > 0) {
        await supabase
          .from('professional_product_overrides')
          .delete()
          .eq('professional_id', proId)
          .eq('organization_id', orgId)
          .in('product_id', alvosDaSaida);
      }
    }
  }

  if (entraram.length > 0) {
    const { error } = await supabase
      .from('professional_specialties')
      .insert(entraram.map((specialty_id) => ({
        professional_id: proId,
        specialty_id,
        organization_id: orgId,
      })));
    if (error) return { mirror: null, error };

    // Especialidade que ENTRA limpa as exceções nos procedimentos dela: é o
    // "tirei e coloquei de novo, voltou ao padrão" que o Junior espera.
    const { data: procedimentos } = await supabase
      .from('specialty_products')
      .select('product_id')
      .eq('organization_id', orgId)
      .in('specialty_id', entraram);
    const alvos = [...new Set((procedimentos || [])
      .map((r) => String((r as { product_id: string }).product_id)))];
    if (alvos.length > 0) {
      await supabase
        .from('professional_product_overrides')
        .delete()
        .eq('professional_id', proId)
        .eq('organization_id', orgId)
        .in('product_id', alvos);
    }
  }

  if (ids.length === 0) return { mirror: null, error: null };

  const { data: nomes, error: nomesError } = await supabase
    .from('specialties')
    .select('id, name')
    .eq('organization_id', orgId)
    .in('id', ids);
  if (nomesError) return { mirror: null, error: nomesError };

  const mirror = (nomes || [])
    .map((n) => String((n as { name: string }).name))
    .sort((a, b) => a.localeCompare(b))[0] || null;

  return { mirror, error: null };
}

async function syncSpecialties(
  professionalId: string,
  organizationId: string,
  specialtyIds: string[],
): Promise<{ mirror: string | null; error: Error | null }> {
  if (!supabase) return { mirror: null, error: new Error('Supabase não configurado') };
  // Compatibilidade para clientes/mocks anteriores à RPC; o cliente Supabase
  // usado pela aplicação sempre possui `rpc`.
  if (typeof supabase.rpc !== 'function') {
    return syncSpecialtiesLegacy(professionalId, organizationId, specialtyIds);
  }
  const orgId = sanitizeUUID(organizationId);
  const proId = sanitizeUUID(professionalId);
  if (!orgId || !proId) return { mirror: null, error: new Error('Organização ou profissional inválido') };
  const ids = [...new Set(specialtyIds.map((id) => sanitizeUUID(id)).filter(Boolean))] as string[];
  const { data, error } = await supabase.rpc('sync_professional_specialties', {
    p_organization_id: orgId,
    p_professional_id: proId,
    p_specialty_ids: ids,
  });
  return { mirror: typeof data === 'string' ? data : null, error: error ?? null };
}

// Mantido temporariamente para compatibilidade de leitura durante a migração;
// todas as escritas novas usam a RPC transacional acima.
void syncSpecialtiesLegacy;

export const professionalsService = {
  async getAll(organizationId: string): Promise<{ data: Professional[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
      const orgId = sanitizeUUID(organizationId);
      if (!orgId) return { data: [], error: new Error('Organização inválida') };

      const query = supabase
        .from('professionals')
        .select(SELECT_COLUMNS)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbProfessional[];
      return { data: rows.map(transformProfessional), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async getActive(organizationId: string): Promise<{ data: Professional[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };
      const orgId = sanitizeUUID(organizationId);
      if (!orgId) return { data: [], error: new Error('Organização inválida') };

      const query = supabase
        .from('professionals')
        .select(SELECT_COLUMNS)
        .eq('organization_id', orgId)
        .eq('active', true)
        .order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) return { data: [], error };

      const rows = (data || []) as DbProfessional[];
      return { data: rows.map(transformProfessional), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: {
    name: string;
    specialty?: string;
    specialtyIds?: string[];
    role?: string;
    payType?: 'fixed' | 'commission' | 'both';
    fixedAmount?: number;
    active?: boolean;
    organizationId: string;
  }): Promise<{ data: Professional | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const organizationId = sanitizeUUID(input.organizationId);
      if (!organizationId) return { data: null, error: new Error('Organização inválida') };

      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('professionals')
        .insert({
          name: input.name,
          specialty: input.specialty || null,
          role: input.role || null,
          pay_type: input.payType || 'commission',
          fixed_amount: input.fixedAmount ?? 0,
          active: input.active ?? true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select(SELECT_COLUMNS)
        .single();

      if (error) return { data: null, error };

      const criado = transformProfessional(data as DbProfessional);

      if (input.specialtyIds && input.specialtyIds.length > 0) {
        const { mirror, error: syncError } = await syncSpecialties(
          criado.id,
          organizationId,
          input.specialtyIds,
        );
        // A pessoa já foi criada: não desfaz o cadastro por causa das
        // especialidades — devolve o erro pra tela avisar e ele reeditar.
        if (syncError) return { data: criado, error: syncError };
        if (mirror) {
          await supabase
            .from('professionals')
            .update({ specialty: mirror })
            .eq('id', criado.id)
            .eq('organization_id', organizationId);
        }
        const { data: recarregado } = await supabase
          .from('professionals')
          .select(SELECT_COLUMNS)
          .eq('id', criado.id)
          .eq('organization_id', organizationId)
          .single();
        if (recarregado) return { data: transformProfessional(recarregado as DbProfessional), error: null };
      }

      return { data: criado, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(id: string, updates: Partial<{
    name: string;
    specialty?: string;
    specialtyIds: string[];
    role?: string;
    payType: 'fixed' | 'commission' | 'both';
    fixedAmount: number;
    active: boolean;
  }>, organizationId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const proId = sanitizeUUID(id);
      const orgId = sanitizeUUID(organizationId);
      if (!proId || !orgId) return { error: new Error('Organização ou profissional inválido') };

      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.specialty !== undefined) payload.specialty = updates.specialty || null;
      if (updates.role !== undefined) payload.role = updates.role || null;
      if (updates.payType !== undefined) payload.pay_type = updates.payType;
      if (updates.fixedAmount !== undefined) payload.fixed_amount = updates.fixedAmount;
      if (updates.active !== undefined) payload.active = updates.active;
      payload.updated_at = new Date().toISOString();

      // As especialidades vêm antes: o espelho legado sai delas.
      if (updates.specialtyIds !== undefined) {
        const { mirror, error: syncError } = await syncSpecialties(
          proId,
          orgId,
          updates.specialtyIds,
        );
        if (syncError) return { error: syncError };
        payload.specialty = mirror;
      }

      const { error } = await supabase
        .from('professionals')
        .update(payload)
        .eq('id', proId)
        .eq('organization_id', orgId);

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string, organizationId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const proId = sanitizeUUID(id);
      const orgId = sanitizeUUID(organizationId);
      if (!proId || !orgId) return { error: new Error('Organização ou profissional inválido') };
      const { error } = await supabase
        .from('professionals')
        .delete()
        .eq('id', proId)
        .eq('organization_id', orgId);

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
