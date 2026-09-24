'use client';

/**
 * Agenda NOSSA — fatia 1 (Junior, 28/07/2026). Controller da visão de DIA no
 * padrão que a recepção já conhece do Clinicorp: colunas por dentista, grade de
 * meia em meia hora. Nesta fatia NADA toca o Clinicorp.
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/context/TenantContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase/client';
import { appointmentsLocalService, type AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import { reunioesDaIaService } from '@/lib/supabase/agendaReunioes';
import { contactsService } from '@/lib/supabase/contacts';
import { COLUNA_PADRAO_ID } from '../components/agendaFormato';

/**
 * A coluna padrao e uma coluna da TELA, nao uma linha de `professionals`. Antes de
 * gravar ela vira `null` — que e o que a tabela espera de um compromisso sem dono.
 */
function idDeProfissional(valor: string | null | undefined): string | null {
  return !valor || valor === COLUNA_PADRAO_ID ? null : valor;
}
import type { AppointmentStatus } from '@/types';

/** Grade do dia: 08:00 às 19:00, de meia em meia hora (padrão de clínica). */
export const HORA_INICIO = 8;
export const HORA_FIM = 19;
export const MINUTOS_POR_VAGA = 30;

export function vagasDoDia(): string[] {
  const vagas: string[] = [];
  for (let h = HORA_INICIO; h < HORA_FIM; h += 1) {
    for (let m = 0; m < 60; m += MINUTOS_POR_VAGA) {
      vagas.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return vagas;
}

function hojeIso(): string {
  const agora = new Date();
  return isoDe(agora);
}

/** Date local → "YYYY-MM-DD" (sem passar por UTC, que muda o dia). */
function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function somarDias(dataIso: string, quantos: number): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  return isoDe(new Date(ano, mes - 1, dia + quantos));
}

/** Visões do calendário. Semana e mês são de UM profissional (pedido do Junior, 29/07). */
export type VisaoAgenda = 'dia' | 'semana' | 'mes';

/** Segunda-feira da semana da data (a semana da clínica começa na segunda). */
export function inicioDaSemana(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  // getDay(): 0=domingo … 6=sábado. Domingo recua 6 dias, não 0.
  const recuo = (d.getDay() + 6) % 7;
  return somarDias(dataIso, -recuo);
}

/** Os 7 dias da semana da data, de segunda a domingo. Nenhum dia fica de fora
 *  — consulta marcada no domingo tem que aparecer, não sumir da tela. */
export function diasDaSemana(dataIso: string): string[] {
  const segunda = inicioDaSemana(dataIso);
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
}

/** Células do mês, alinhadas por dia da semana. `null` = célula de preenchimento
 *  antes do dia 1 ou depois do último dia. */
export function celulasDoMes(dataIso: string): (string | null)[] {
  const [ano, mes] = dataIso.split('-').map(Number);
  const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const vazias = (new Date(ano, mes - 1, 1).getDay() + 6) % 7;
  const totalDeDias = new Date(ano, mes, 0).getDate();
  const celulas: (string | null)[] = Array.from({ length: vazias }, () => null);
  for (let i = 0; i < totalDeDias; i += 1) celulas.push(somarDias(primeiro, i));
  while (celulas.length % 7 !== 0) celulas.push(null);
  return celulas;
}

/** Janela de datas que a visão precisa buscar. `ate` é exclusivo. */
export function intervaloDaVisao(visao: VisaoAgenda, dataIso: string): { de: string; ate: string } {
  if (visao === 'semana') {
    const segunda = inicioDaSemana(dataIso);
    return { de: segunda, ate: somarDias(segunda, 7) };
  }
  if (visao === 'mes') {
    const [ano, mes] = dataIso.split('-').map(Number);
    const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
    return { de: primeiro, ate: somarDias(primeiro, new Date(ano, mes, 0).getDate()) };
  }
  return { de: dataIso, ate: somarDias(dataIso, 1) };
}

/** "YYYY-MM-DD" + "HH:mm" LOCAIS → ISO UTC (o banco guarda timestamptz). */
export function paraIsoLocal(dataIso: string, hora: string): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const [h, m] = hora.split(':').map(Number);
  return new Date(ano, mes - 1, dia, h, m, 0, 0).toISOString();
}

/** ISO UTC → "HH:mm" local (pra encaixar a marcação na linha certa da grade). */
export function horaLocalDe(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type NovaConsulta = {
  /** Contato que ja existe na lista. Vazio quando a marcacao e para alguem de fora dela. */
  contactId: string;
  /**
   * Lead que AINDA NAO esta em Contatos — indicacao que chamou no WhatsApp pessoal, prospeccao
   * propria (pedido do Junior, 24/09/2026: "eu como dono da agenda preciso poder marcar hora
   * mesmo que o lead nao esteja ali em contatos"). Vira contato na hora, porque `appointments`
   * NAO tem coluna de nome: sem contato a marcacao apareceria anonima na grade.
   */
  novoContato?: { name: string; phone?: string };
  /** `null` = coluna padrao (organizacao sem equipe cadastrada). */
  professionalId: string | null;
  hora: string;
  duracaoMin: number;
  notes?: string;
};

export function useAgendaLocalController() {
  const { tenant } = useTenant();
  // Admin de agencia SEM cliente escolhido recebe `tenant: null` da API (por desenho: a
  // plataforma quer escolha explicita). Sem isso a agenda nao consultava NADA e a tela
  // ficava vazia mesmo com reuniao marcada — era o "continua vazio" do Junior (23/09).
  // A queda e para a organizacao do PROPRIO perfil: e a dele, e a RLS continua decidindo.
  const { organizationId: organizacaoDoPerfil } = useAuth();
  const organizationId = tenant?.organizationId || organizacaoDoPerfil || null;
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [date, setDate] = useState<string>(hojeIso());
  const [visao, setVisao] = useState<VisaoAgenda>('dia');

  const intervalo = useMemo(() => intervaloDaVisao(visao, date), [visao, date]);

  const chave = useMemo(
    () => ['agenda-dia', organizationId, intervalo.de, intervalo.ate] as const,
    [organizationId, intervalo.de, intervalo.ate],
  );

  /**
   * Nome da organizacao para o cabecalho da coluna padrao. O `tenant` so traz o nome
   * quando ha cliente escolhido; caindo para a organizacao do proprio perfil o nome nao
   * vem junto, e a coluna ficava "Minha agenda" numa hora e "CENNO HUB" noutra, na MESMA
   * tela, conforme o caminho que a pessoa usou para chegar. Uma linha do banco resolve
   * (RLS `organizations_select_by_tenant` decide).
   */
  const nomeDaOrganizacao = useQuery({
    queryKey: ['agenda-nome-organizacao', organizationId] as const,
    enabled: Boolean(organizationId) && !tenant?.organizationName,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      if (!supabase) return null;
      const { data } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId as string)
        .maybeSingle();
      return (data as { name?: string } | null)?.name || null;
    },
  });

  const consulta = useQuery({
    queryKey: chave,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const deIso = paraIsoLocal(intervalo.de, '00:00');
      const ateIso = paraIsoLocal(intervalo.ate, '00:00');
      // As DUAS fontes da agenda, em paralelo: o que foi marcado na mao (`appointments`)
      // e o que a IA marcou na conversa (`activities` do tipo MEETING, espelhadas no
      // Google). Antes so a primeira era lida, e por isso a tela parecia vazia.
      const [marcacoes, reunioes] = await Promise.all([
        appointmentsLocalService.listar(organizationId as string, deIso, ateIso),
        reunioesDaIaService.listar(organizationId as string, deIso, ateIso),
      ]);
      if (marcacoes.error) throw marcacoes.error;
      // Falha ao ler as reunioes da IA nao derruba a agenda: perde-se uma fonte, nao a tela.
      return [...marcacoes.data, ...reunioes.data]
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },
  });

  const recarregar = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['agenda-dia'] }),
    [queryClient],
  );

  const criarMutation = useMutation({
    mutationFn: async (nova: NovaConsulta) => {
      if (!organizationId) throw new Error('Cliente não carregado ainda.');

      // Marcação para alguém que ainda não está em Contatos: o contato nasce aqui, antes da
      // consulta. Não é firula de cadastro — `appointments` não tem coluna de nome, e a grade
      // monta o nome exclusivamente pelo join com `contacts`. Sem isto a marcação apareceria
      // como "Sem contato" na agenda, que é exatamente o contrário de "deixar registrado".
      let contactId = nova.contactId;
      if (!contactId && nova.novoContato?.name.trim()) {
        const { data: criado, error: erroContato } = await contactsService.create({
          organizationId,
          name: nova.novoContato.name.trim(),
          email: '',
          phone: nova.novoContato.phone?.trim() || '',
          status: 'ACTIVE',
          stage: 'LEAD',
          source: 'agenda',
        });
        if (erroContato) throw erroContato;
        if (!criado?.id) throw new Error('Não deu pra criar o contato.');
        contactId = criado.id;
      }
      if (!contactId) throw new Error('Escolha um contato ou informe o nome de quem vai ser atendido.');

      const startsAtIso = paraIsoLocal(date, nova.hora);
      const fim = new Date(new Date(startsAtIso).getTime() + nova.duracaoMin * 60_000).toISOString();
      const { error } = await appointmentsLocalService.criar({
        organizationId,
        contactId,
        professionalId: idDeProfissional(nova.professionalId),
        startsAtIso,
        endsAtIso: fim,
        notes: nova.notes,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      showToast('Consulta marcada', 'success');
      await recarregar();
    },
    onError: (e: Error) => showToast(`Não deu pra marcar: ${e.message}`, 'error'),
  });

  const remarcarMutation = useMutation({
    mutationFn: async (params: { id: string; dataIso: string; hora: string; duracaoMin: number; professionalId?: string }) => {
      const startsAtIso = paraIsoLocal(params.dataIso, params.hora);
      const fim = new Date(new Date(startsAtIso).getTime() + params.duracaoMin * 60_000).toISOString();
      const { error } = await appointmentsLocalService.remarcar(params.id, {
        startsAtIso,
        endsAtIso: fim,
        professionalId: idDeProfissional(params.professionalId) ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      showToast('Consulta remarcada', 'success');
      await recarregar();
    },
    onError: (e: Error) => showToast(`Não deu pra remarcar: ${e.message}`, 'error'),
  });

  const statusMutation = useMutation({
    mutationFn: async (params: { id: string; status: AppointmentStatus }) => {
      const { error } = await appointmentsLocalService.mudarStatus(params.id, params.status);
      if (error) throw error;
    },
    onSuccess: async () => {
      showToast('Consulta atualizada', 'success');
      await recarregar();
    },
    onError: (e: Error) => showToast(`Não deu pra atualizar: ${e.message}`, 'error'),
  });

  /** ‹ e › andam na unidade da visão: 1 dia, 1 semana ou 1 mês. */
  const avancar = useCallback(
    (quantos: number) => {
      setDate((atual) => {
        if (visao === 'semana') return somarDias(atual, quantos * 7);
        if (visao === 'mes') {
          const [ano, mes, dia] = atual.split('-').map(Number);
          const alvo = new Date(ano, mes - 1 + quantos, 1);
          // dia 31 → mês curto: encaixa no último dia do mês de destino
          const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
          alvo.setDate(Math.min(dia, ultimoDia));
          return isoDe(alvo);
        }
        return somarDias(atual, quantos);
      });
    },
    [visao],
  );

  return {
    /** Nome para a coluna padrao: o do cliente escolhido, senao o da organizacao do perfil. */
    organizationName: tenant?.organizationName || nomeDaOrganizacao.data || null,
    date,
    setDate,
    visao,
    setVisao,
    intervalo,
    avancar,
    voltarPraHoje: useCallback(() => setDate(hojeIso()), []),
    appointments: (consulta.data ?? []) as AppointmentDoDia[],
    isLoading: consulta.isLoading,
    error: consulta.error as Error | null,
    criar: criarMutation.mutateAsync,
    criando: criarMutation.isPending,
    remarcar: remarcarMutation.mutateAsync,
    remarcando: remarcarMutation.isPending,
    mudarStatus: statusMutation.mutateAsync,
    mudandoStatus: statusMutation.isPending,
  };
}
