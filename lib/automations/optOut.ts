/**
 * Opt-out de automações (2c): o lead manda uma palavra de parada e o CRM para de
 * mandar mensagens automáticas para ele.
 *
 * Regra: a mensagem INTEIRA (sem acento, sem pontuação, maiúscula) tem que ser uma das
 * palavras da lista. "quero parar de fumar" não é opt-out; "PARAR" é. Assim a régua nunca
 * cala uma conversa por engano — errar para o lado de não calar é mais barato do que
 * calar quem queria continuar.
 */

const OPT_OUT_KEYWORDS: readonly string[] = [
  'PARAR',
  'PARE',
  'SAIR',
  'STOP',
  'CANCELAR',
  'CANCELA',
  'DESCADASTRAR',
  'DESCADASTRA',
  'REMOVER',
  'PARAR MENSAGENS',
  'PARAR DE RECEBER',
  'NAO QUERO RECEBER',
  'NAO QUERO MAIS RECEBER',
  'NAO QUERO MAIS',
  'ME TIRA DA LISTA',
  'ME TIRE DA LISTA',
];

const MAX_OPT_OUT_LENGTH = 48;

const OPT_OUT_SET = new Set(OPT_OUT_KEYWORDS);

export function normalizeOptOutText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devolve a palavra de parada reconhecida (já normalizada) ou null.
 */
export function detectAutomationOptOut(content: string | null | undefined): string | null {
  const raw = (content ?? '').trim();
  if (!raw || raw.length > MAX_OPT_OUT_LENGTH) return null;
  const normalized = normalizeOptOutText(raw);
  if (!normalized) return null;
  return OPT_OUT_SET.has(normalized) ? normalized : null;
}

export const AUTOMATION_OPT_OUT_KEYWORDS = OPT_OUT_KEYWORDS;
