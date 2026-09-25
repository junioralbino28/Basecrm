/**
 * Identidade do atendente humano no texto que o lead recebe.
 *
 * Decisao do Junior (25/09/2026): para o lead o NUMERO nunca muda; o que muda e o NOME de quem
 * esta atendendo, na frente da mensagem. Vale SO para resposta humana manual — a IA continua se
 * apresentando pelo texto do proprio prompt, e assinar tambem ela produziria
 * "Aurora: Oi, aqui e a Aurora".
 *
 * Duas regras de fundo, as duas vindas de erro medido:
 *
 * 1. O prefixo entra SO no texto entregue a Evolution. O `content` gravado em
 *    `conversation_messages` fica sem ele de proposito: o historico que a IA le ja traz o autor
 *    num campo separado (`formatRecentMessages`), e o prefixo dentro do texto duplicaria o dado.
 *
 * 2. NAO existe guarda de "o texto ja comeca com o meu nome". Deduzir assinatura pela aparencia
 *    da string erra nos dois sentidos: um atendente de apelido "Rio" escrevendo
 *    "Rio: quinta; SP: sexta" seria lido como ja assinado, e "Vitoria : oi" (espaco antes dos
 *    dois-pontos) escaparia e sairia duplicado. O Junior fechou o caso: ninguem digita o proprio
 *    nome, no maximo se apresenta — e com o nome aparecendo, nem a apresentacao e necessaria.
 */

/** Limites do payload externo, em unidades UTF-16, contados DEPOIS do prefixo. */
export const LIMITE_TEXTO_EXTERNO = 4000;
export const LIMITE_LEGENDA_EXTERNA = 1024;

const TEM_LETRA = /\p{L}/u;

/** Nasce desligado em todo cliente: so o booleano verdadeiro liga. */
export function resolveAssinaturaAtivada(config: Record<string, unknown> | null | undefined) {
  return (config as { signManualReplies?: unknown } | null | undefined)?.signManualReplies === true;
}

/**
 * Nome que o LEAD pode ver. Diferente de `getConversationAssigneeDisplayName`, que resolve nome
 * para uso interno do CRM e cai no trecho antes do @ do e-mail: aqui esse fallback nao existe,
 * porque vazaria parte do endereco para fora. Sem nome utilizavel devolve null, e quem chamou
 * decide o que fazer — com a assinatura ligada, recusar o envio.
 */
export function resolveNomeDoAtendente(profile: {
  nickname?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}) {
  const candidatos = [
    profile.nickname,
    [profile.first_name, profile.last_name].map((parte) => parte?.trim()).filter(Boolean).join(' '),
    profile.first_name,
  ];

  for (const candidato of candidatos) {
    const nome = (candidato || '').trim();
    if (nome && TEM_LETRA.test(nome)) return nome;
  }

  return null;
}

export function assinarMensagemDoAtendente(params: {
  texto: string;
  nomeDoAtendente: string | null | undefined;
  ativada: boolean;
}) {
  const { texto, nomeDoAtendente, ativada } = params;
  if (!ativada) return texto;

  // Midia sem legenda nao ganha legenda: assinar aqui criaria um texto onde nao havia nenhum.
  const corpo = texto.trim();
  if (!corpo) return texto;

  const nome = (nomeDoAtendente || '').trim();
  if (!nome || !TEM_LETRA.test(nome)) return texto;

  return `${nome}: ${corpo}`;
}
