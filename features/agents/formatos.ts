import type { VersaoResumo } from '@/lib/agents/tiposDoEditor';

/** Data e hora de Brasília, sempre: o banco guarda em UTC. Ex.: "07/10/2026 às 01:51". */
export function formatarDataHora(iso: string): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute}`;
}

/** "Versão N publicada em [data] por [pessoa]" (SPEC, fatia 2). */
export function descreverVersao(v: VersaoResumo): string {
  const quem =
    v.origem === 'migration' ? 'pela migração' : v.publicadaPor ? `por ${v.publicadaPor}` : 'por alguém que saiu da equipe';
  const restaurada = v.origem === 'restore' && v.restauradaDe ? ` (restaurada da versão ${v.restauradaDe})` : '';
  return `Versão ${v.versao}${restaurada} publicada em ${formatarDataHora(v.publicadaEm)} ${quem}`;
}
