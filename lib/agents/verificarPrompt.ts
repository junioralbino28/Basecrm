/**
 * Verificação ao vivo do prompt de um agente (Central de Agentes, fatia 2; SPEC, "Verificação ao vivo").
 * Função pura, a mesma na tela e no servidor: a tela roda enquanto se edita; a rota de publicar roda de novo
 * sobre o rascunho GRAVADO e é ela que decide (erro bloqueia; aviso só passa confirmado).
 */

/**
 * As 12 variáveis que o runtime troca (lib/conversations/aiReply.ts, objeto passado a renderPromptTemplate).
 * verificarPrompt.test.ts lê aiReply.ts e trava esta lista.
 */
export const VARIAVEIS_DO_PROMPT = [
  'organizationName',
  'contactName',
  'contactPhone',
  'currentDateTime',
  'currentDateTimeLocal',
  'timezone',
  'meetingHostName',
  'meetingChannelText',
  'conversationStageContext',
  'recentMessagesText',
  'calendarContext',
  'availableTagsContext',
] as const;
export type VariavelDoPrompt = (typeof VARIAVEIS_DO_PROMPT)[number];

export const LIMITE_DE_AVISO_DE_TAMANHO = 30_000;

export type NivelDoItem = 'erro' | 'aviso' | 'info';
export type ItemDaVerificacao = { codigo: string; nivel: NivelDoItem; mensagem: string };
export type ResultadoDaVerificacao = {
  erros: ItemDaVerificacao[];
  avisos: ItemDaVerificacao[];
  informacoes: ItemDaVerificacao[];
};
export type EntradaDaVerificacao = {
  /** O texto que vai ser publicado. */
  rascunho: string;
  /** O texto da versão publicada hoje; null se o agente nunca publicou. */
  publicado: string | null;
  /** Quantos números ligados a este agente têm a agenda ligada. */
  numerosLigadosComAgenda: number;
};

const CONHECIDAS = new Set<string>(VARIAVEIS_DO_PROMPT);
/**
 * O nome do marcador sem espaço, tab e quebra de linha ASCII nas pontas: a MESMA regra do banco
 * (`central_agentes_variavel_desconhecida`). Um NBSP ou outro espaço Unicode não é aparado em nenhum dos dois lados
 * e torna o marcador desconhecido. Revisão do Codex, rodada 2: com `.trim()` aqui e `\s` no banco, um NBSP no fim
 * do nome passava na tela e era recusado no banco (medido em PGlite 18.3, 07/10). A matriz comum da Task 4 trava
 * tela, banco e renderizador juntos.
 */
export function nomeDoMarcador(miolo: string): string {
  return miolo.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}
/** Tudo entre {{ e }}. O runtime só troca `[\w.]+` e deixa o resto literal; qualquer marcador fora das 12 é erro. */
const MARCADOR = /\{\{([^{}]*)\}\}/g;
/**
 * "[Texto com maiúscula]" que não é link de markdown: cara de pendência ("[Nome da empresa]"). Link em linha
 * ("[Guia](url)") e link de referência ("[Guia][ref]") não contam.
 */
const PENDENCIA = /\[([A-ZÀ-Ý][^[\]\n]{1,80})\](?![([])/g;
/**
 * A instrução de saída é a LINHA DE CAMPO, no começo da linha: "- replyText: ..." (como nos dois prompts do catálogo
 * em 07/10) ou "replyText:" / "\"replyText\":". Uma menção solta ("nunca escreva replyText") não conta: senão
 * tirar o campo e deixar a menção apagaria o aviso perdeu:replyText (revisão do Codex, 07/10).
 */
const REPLY_TEXT = /^[ \t]*(?:-[ \t]*)?"?replyText"?[ \t]*:/m;

export function usaVariavel(texto: string, nome: VariavelDoPrompt): boolean {
  return new RegExp(`\\{\\{[ \\t\\r\\n]*${nome}[ \\t\\r\\n]*\\}\\}`).test(texto);
}

const MENSAGEM_DA_PERDA: Partial<Record<VariavelDoPrompt, string>> = {
  conversationStageContext:
    'O rascunho tirou {{conversationStageContext}}: sem ele o agente deixa de encerrar a conversa depois do repasse para uma pessoa.',
  calendarContext: 'O rascunho tirou {{calendarContext}}: o agente deixa de ver os horários livres da agenda.',
  recentMessagesText: 'O rascunho tirou {{recentMessagesText}}: o agente deixa de ler as últimas mensagens da conversa.',
};

export function verificarPrompt(entrada: EntradaDaVerificacao): ResultadoDaVerificacao {
  const { rascunho, publicado, numerosLigadosComAgenda } = entrada;
  const erros: ItemDaVerificacao[] = [];
  const avisos: ItemDaVerificacao[] = [];
  const informacoes: ItemDaVerificacao[] = [];

  const desconhecidas = new Map<string, string>();
  for (const m of rascunho.matchAll(MARCADOR)) {
    const nome = nomeDoMarcador(m[1]);
    if (!CONHECIDAS.has(nome) && !desconhecidas.has(nome)) desconhecidas.set(nome, m[0]);
  }
  for (const [nome, marcador] of desconhecidas) {
    erros.push({
      codigo: `variavel_desconhecida:${nome}`,
      nivel: 'erro',
      mensagem: `${marcador} não é uma das 12 variáveis do agente. Corrija antes de publicar.`,
    });
  }

  const pendencias = [...new Set([...rascunho.matchAll(PENDENCIA)].map((m) => m[0]))];
  if (pendencias.length > 0) {
    const mais = pendencias.length > 3 ? ` e mais ${pendencias.length - 3}` : '';
    avisos.push({
      codigo: 'pendencia',
      nivel: 'aviso',
      mensagem: `Trecho com cara de pendência: ${pendencias.slice(0, 3).join(', ')}${mais}.`,
    });
  }
  if (usaVariavel(rascunho, 'calendarContext') && numerosLigadosComAgenda === 0) {
    avisos.push({
      codigo: 'agenda_sem_numero',
      nivel: 'aviso',
      mensagem: 'O prompt usa {{calendarContext}}, mas nenhum número ligado a este agente tem a agenda ligada: a IA vai receber "agenda não configurada" e não vai oferecer horários.',
    });
  }
  if (rascunho.length > LIMITE_DE_AVISO_DE_TAMANHO) {
    avisos.push({
      codigo: 'tamanho',
      nivel: 'aviso',
      mensagem: `O prompt tem ${rascunho.length.toLocaleString('pt-BR')} caracteres, acima de 30 mil: cada resposta fica mais cara e mais lenta.`,
    });
  }

  if (publicado !== null) {
    for (const nome of VARIAVEIS_DO_PROMPT) {
      if (usaVariavel(publicado, nome) && !usaVariavel(rascunho, nome)) {
        avisos.push({
          codigo: `perdeu:${nome}`,
          nivel: 'aviso',
          mensagem: MENSAGEM_DA_PERDA[nome] ?? `O rascunho tirou {{${nome}}}, que a versão publicada usa.`,
        });
      }
    }
    if (REPLY_TEXT.test(publicado) && !REPLY_TEXT.test(rascunho)) {
      avisos.push({
        codigo: 'perdeu:replyText',
        nivel: 'aviso',
        mensagem: 'O rascunho tirou a instrução de replyText, que diz à IA onde escrever a resposta.',
      });
    }
  }

  if (!usaVariavel(rascunho, 'conversationStageContext') && (publicado === null || !usaVariavel(publicado, 'conversationStageContext'))) {
    informacoes.push({
      codigo: 'sem_encerramento',
      nivel: 'info',
      mensagem: 'Este agente não faz encerramento depois do repasse: o prompt não tem {{conversationStageContext}}.',
    });
  }
  if (!REPLY_TEXT.test(rascunho) && (publicado === null || !REPLY_TEXT.test(publicado))) {
    informacoes.push({
      codigo: 'sem_replyText',
      nivel: 'info',
      mensagem: 'O prompt não tem a linha de campo replyText; a resposta segue só o formato que o sistema pede.',
    });
  }

  return { erros, avisos, informacoes };
}

/** Avisos que o pedido de publicar não confirmou. A rota recusa publicar enquanto sobrar algum. */
export function avisosNaoConfirmados(resultado: ResultadoDaVerificacao, confirmados: readonly string[]): string[] {
  const ok = new Set(confirmados);
  return resultado.avisos.map((a) => a.codigo).filter((codigo) => !ok.has(codigo));
}
