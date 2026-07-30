/**
 * Formato compartilhado pelas 3 visões da agenda (dia, semana, mês).
 * Uma cor de status, um rótulo de status, um jeito de virar data em texto —
 * espelhado entre as grades pra não nascer dialeto em cada tela.
 */
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';

export const ROTULOS_DE_STATUS: Record<string, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  compareceu: 'Compareceu',
  faltou: 'Faltou',
  cancelado: 'Cancelado',
  remarcado: 'Remarcado',
};

export const CORES_DE_STATUS: Record<string, string> = {
  agendado: 'border-brand-400/60 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200',
  confirmado: 'border-emerald-400/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  compareceu: 'border-teal-400/60 bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200',
  faltou: 'border-red-400/60 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200',
  cancelado: 'border-slate-300 bg-slate-50 text-slate-500 line-through dark:bg-white/5 dark:text-slate-400',
  remarcado: 'border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
};

/** Ponto colorido do mês — mesma semântica das cores acima, em versão mínima. */
export const PONTO_DE_STATUS: Record<string, string> = {
  agendado: 'bg-brand-500',
  confirmado: 'bg-emerald-500',
  compareceu: 'bg-teal-500',
  faltou: 'bg-red-500',
  cancelado: 'bg-slate-400',
  remarcado: 'bg-amber-500',
};

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** ISO UTC da consulta → "YYYY-MM-DD" LOCAL (o dia que a recepção enxerga). */
export function diaLocalDe(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-07-30" → "qui 30/07" (cabeçalho da semana). */
export function rotuloCurtoDoDia(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return `${DIAS_CURTOS[d.getDay()]} ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

/** "2026-07" → "julho de 2026" (título do mês). */
export function rotuloDoMes(dataIso: string): string {
  const [ano, mes] = dataIso.split('-').map(Number);
  const nomes = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  return `${nomes[mes - 1]} de ${ano}`;
}

/**
 * Cor de IDENTIDADE do profissional (visão "Todos"). Ela responde "de quem é
 * esta consulta" — a SITUAÇÃO (confirmado, faltou, cancelado) continua no fundo
 * do cartão, com as cores de status acima. Uma coisa não substitui a outra.
 *
 * As classes ficam escritas por extenso de propósito: o Tailwind varre o código
 * em busca de nomes literais e não enxerga classe montada por concatenação.
 */
export const PALETA_DE_PROFISSIONAL = [
  { faixa: 'bg-indigo-500', texto: 'text-indigo-700 dark:text-indigo-300', ponto: 'bg-indigo-500' },
  { faixa: 'bg-cyan-500', texto: 'text-cyan-700 dark:text-cyan-300', ponto: 'bg-cyan-500' },
  { faixa: 'bg-fuchsia-500', texto: 'text-fuchsia-700 dark:text-fuchsia-300', ponto: 'bg-fuchsia-500' },
  { faixa: 'bg-orange-500', texto: 'text-orange-700 dark:text-orange-300', ponto: 'bg-orange-500' },
  { faixa: 'bg-violet-500', texto: 'text-violet-700 dark:text-violet-300', ponto: 'bg-violet-500' },
  { faixa: 'bg-sky-500', texto: 'text-sky-700 dark:text-sky-300', ponto: 'bg-sky-500' },
  { faixa: 'bg-lime-600', texto: 'text-lime-700 dark:text-lime-300', ponto: 'bg-lime-600' },
  { faixa: 'bg-rose-500', texto: 'text-rose-700 dark:text-rose-300', ponto: 'bg-rose-500' },
] as const;

/** Mesma pessoa = mesma cor, sempre. Deriva do id (não da posição na lista),
 *  senão cadastrar alguém novo trocaria a cor de todo mundo. */
export function corDoProfissional(professionalId: string): (typeof PALETA_DE_PROFISSIONAL)[number] {
  let soma = 0;
  for (let i = 0; i < professionalId.length; i += 1) soma = (soma * 31 + professionalId.charCodeAt(i)) >>> 0;
  return PALETA_DE_PROFISSIONAL[soma % PALETA_DE_PROFISSIONAL.length];
}

/** "Dra. Jéssica Barros" → "Jéssica" (chip da visão de todos, que é apertado).
 *  Ignora o tratamento (Dr./Dra.) porque ele não distingue ninguém. */
export function primeiroNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => !/^(dr|dra|drª)\.?$/i.test(p));
  return partes[0] || nome;
}

/** Agrupa as consultas por dia local, já ordenadas por horário. */
export function porDia(appointments: AppointmentDoDia[]): Map<string, AppointmentDoDia[]> {
  const mapa = new Map<string, AppointmentDoDia[]>();
  for (const appt of appointments) {
    const dia = diaLocalDe(appt.startsAt);
    const lista = mapa.get(dia);
    if (lista) lista.push(appt);
    else mapa.set(dia, [appt]);
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return mapa;
}
