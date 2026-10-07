/** Escolha do modo do scripts/central-agentes/migrar-agentes.ts: um por chamada, e os que recebem número exigem o id. */
export type ModoDaMigracao =
  | { modo: 'prova' }
  | { modo: 'criar' }
  | { modo: 'ligar' | 'desligar' | 'webhook'; numero: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ehUuid = (valor: string | null | undefined): valor is string => Boolean(valor && UUID.test(valor));

/**
 * Revisão do Codex, 07/10: `--webhook` sem id passava pela escolha antiga, pulava o `if (webhook)` e terminava com a
 * prova geral e saída 0. Aqui, nenhum modo, dois modos ou número que não é uuid voltam como erro, antes de qualquer rede.
 */
export function escolherModo(args: readonly string[]): ModoDaMigracao | { erro: string } {
  const modos = ['--prova', '--criar', '--ligar', '--desligar', '--webhook'].filter((m) => args.includes(m));
  if (modos.length !== 1) {
    return {
      erro: `Use exatamente um modo: --prova, --criar, --ligar <id>, --desligar <id> ou --webhook <id> (veio: ${modos.join(' ') || 'nenhum'}).`,
    };
  }
  const [modo] = modos;
  if (modo === '--prova') return { modo: 'prova' };
  if (modo === '--criar') return { modo: 'criar' };
  const numero = args[args.indexOf(modo) + 1];
  if (!ehUuid(numero)) return { erro: `${modo} exige o id (uuid) do numero.` };
  return { modo: modo.slice(2) as 'ligar' | 'desligar' | 'webhook', numero };
}
