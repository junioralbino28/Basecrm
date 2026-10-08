// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import { VARIAVEIS_DO_PROMPT, avisosNaoConfirmados, verificarPrompt } from './verificarPrompt';

const catalogo = getPromptCatalogMap() as Record<string, { defaultTemplate: string }>;
const AURORA = catalogo.task_conversations_whatsapp_cenno_aurora.defaultTemplate;
const JULIA = catalogo.task_conversations_whatsapp_julia.defaultTemplate;
/** Padrão neutro desde 07/10 (8 seções da SquadOS), para números sem chave e sem agente. */
const PADRAO = catalogo.task_conversations_whatsapp_auto_reply.defaultTemplate;
const PUBLICADO = 'Voce e a Aurora. {{contactName}}\n{{conversationStageContext}}\n- replyText: resposta curta';

const codigos = (itens: Array<{ codigo: string }>) => itens.map((i) => i.codigo);

/**
 * As chaves do objeto que o runtime passa a renderPromptTemplate, lidas do código-fonte. Desde a fatia 3 a única
 * chamada mora no miolo (aiReplyCore.ts), usado pelo atendimento real e pelo teste sem enviar; nenhum dos dois pode
 * montar o prompt por conta própria.
 */
function variaveisDoRuntime(): string[] {
  const ler = (arquivo: string) => readFileSync(resolve(process.cwd(), arquivo), 'utf8');
  const contar = (fonte: string) => fonte.split('renderPromptTemplate(').length - 1;
  expect(contar(ler('lib/conversations/aiReply.ts')), 'chamadas de renderPromptTemplate em aiReply.ts').toBe(0);
  expect(contar(ler('lib/agents/testeDoAgente.ts')), 'chamadas de renderPromptTemplate em testeDoAgente.ts').toBe(0);
  const fonte = ler('lib/conversations/aiReplyCore.ts');
  expect(contar(fonte), 'chamadas de renderPromptTemplate em aiReplyCore.ts').toBe(1);
  const inicio = fonte.indexOf('renderPromptTemplate(promptContent, {');
  expect(inicio, 'a chamada mudou de forma: atualize este leitor').toBeGreaterThan(-1);
  const fim = fonte.indexOf('\n  });', inicio);
  const bloco = fonte.slice(inicio, fim).split('\n').slice(1);
  const chaves: string[] = [];
  for (const linha of bloco) {
    const semComentario = linha.replace(/\/\/.*$/, '');
    const m = /^ {4}([A-Za-z_]\w*)\s*(?::|,\s*$)/.exec(semComentario);
    if (m) chaves.push(m[1]);
  }
  return chaves;
}

describe('verificarPrompt', () => {
  it('a lista das 12 variáveis é exatamente a que o runtime troca (lida de aiReplyCore.ts)', () => {
    const doRuntime = variaveisDoRuntime();
    expect(doRuntime).toHaveLength(12);
    expect([...doRuntime].sort()).toEqual([...VARIAVEIS_DO_PROMPT].sort());
  });

  it('marcador fora das 12 é erro (bloqueia Publicar); espaços dentro das chaves continuam valendo', () => {
    const ok = verificarPrompt({ rascunho: `${PUBLICADO} {{ contactName }}`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(ok.erros).toEqual([]);
    const tabEQuebra = verificarPrompt({ rascunho: `${PUBLICADO} {{\tcontactName\n}}`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(tabEQuebra.erros).toEqual([]);
    // Só espaço, tab e quebra ASCII são aparados, como no banco: um NBSP no nome torna o marcador desconhecido
    // (revisão do Codex, rodada 2; com .trim() aqui e \s no banco, o NBSP passava na tela e era recusado lá).
    const NBSP = String.fromCodePoint(0xa0);
    const comNbsp = verificarPrompt({ rascunho: `${PUBLICADO} {{contactName${NBSP}}}`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(codigos(comNbsp.erros)).toEqual([`variavel_desconhecida:contactName${NBSP}`]);

    const r = verificarPrompt({
      rascunho: `${PUBLICADO} {{nomeDoLead}} {{nome-do-lead}} {{}} {{nomeDoLead}}`,
      publicado: PUBLICADO,
      numerosLigadosComAgenda: 0,
    });
    expect(codigos(r.erros)).toEqual([
      'variavel_desconhecida:nomeDoLead',
      'variavel_desconhecida:nome-do-lead',
      'variavel_desconhecida:',
    ]);
    expect(r.erros.every((e) => e.nivel === 'erro')).toBe(true);
  });

  it('pendência, agenda sem número e tamanho pedem confirmação; link de markdown e colchete minúsculo não', () => {
    const pendencia = verificarPrompt({
      rascunho: `${PUBLICADO}\nAtenda a [Nome da empresa] e veja [o site](https://exemplo.com) [ok], [Guia](https://exemplo.com/guia) e [Manual][ref].`,
      publicado: PUBLICADO,
      numerosLigadosComAgenda: 0,
    });
    expect(codigos(pendencia.avisos)).toEqual(['pendencia']);
    expect(pendencia.avisos[0].mensagem).toContain('[Nome da empresa]');
    expect(pendencia.avisos[0].mensagem).not.toContain('[o site]');
    expect(pendencia.avisos[0].mensagem).not.toContain('[Guia]');
    expect(pendencia.avisos[0].mensagem).not.toContain('[Manual]');

    const comAgenda = `${PUBLICADO}\n{{calendarContext}}`;
    expect(codigos(verificarPrompt({ rascunho: comAgenda, publicado: comAgenda, numerosLigadosComAgenda: 0 }).avisos)).toEqual(['agenda_sem_numero']);
    expect(verificarPrompt({ rascunho: comAgenda, publicado: comAgenda, numerosLigadosComAgenda: 1 }).avisos).toEqual([]);

    const longo = `${PUBLICADO}\n${'x'.repeat(30_000)}`;
    expect(codigos(verificarPrompt({ rascunho: longo, publicado: PUBLICADO, numerosLigadosComAgenda: 0 }).avisos)).toEqual(['tamanho']);
  });

  it('regressão: perder o que a publicada tinha é aviso; nunca ter tido é só informação', () => {
    const semNada = 'Voce e a Aurora.';
    const perdeu = verificarPrompt({ rascunho: semNada, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(codigos(perdeu.avisos)).toEqual(['perdeu:contactName', 'perdeu:conversationStageContext', 'perdeu:replyText']);
    expect(perdeu.avisos[1].mensagem).toContain('encerrar a conversa depois do repasse');
    expect(perdeu.informacoes).toEqual([]);

    const nuncaTeve = verificarPrompt({ rascunho: semNada, publicado: semNada, numerosLigadosComAgenda: 0 });
    expect(nuncaTeve.avisos).toEqual([]);
    expect(codigos(nuncaTeve.informacoes)).toEqual(['sem_encerramento', 'sem_replyText']);
  });

  it('replyText conta só como linha de campo: tirar o campo e deixar uma menção solta ainda avisa', () => {
    const base = 'Voce e a Aurora. {{contactName}}\n{{conversationStageContext}}';
    const soMencao = verificarPrompt({ rascunho: `${base}\nNunca escreva replyText no meio da frase.`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(codigos(soMencao.avisos)).toEqual(['perdeu:replyText']);

    // O campo em JSON, numa linha própria, também é a instrução.
    const emJson = verificarPrompt({ rascunho: `${base}\n  "replyText": "texto para o lead"`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(emJson.avisos).toEqual([]);
  });

  it('a lista das 12 no banco (função auxiliar da migration da Task 1) é a mesma da tela', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261007120000_central_agentes_editor.sql'), 'utf8');
    const funcao = /create or replace function public\.central_agentes_variavel_desconhecida[\s\S]*?array\[([\s\S]*?)\]/.exec(sql);
    expect(funcao, 'a função auxiliar tem que estar na migration (caso positivo do leitor)').not.toBeNull();
    const doBanco = [...funcao![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(doBanco).toHaveLength(12);
    expect([...doBanco].sort()).toEqual([...VARIAVEIS_DO_PROMPT].sort());
  });

  it('agente que nunca publicou: sem aviso de regressão', () => {
    const r = verificarPrompt({ rascunho: 'Voce e a Aurora.\n- replyText: resposta curta', publicado: null, numerosLigadosComAgenda: 0 });
    expect(r.avisos).toEqual([]);
    expect(codigos(r.informacoes)).toEqual(['sem_encerramento']);
  });

  it('avisosNaoConfirmados devolve só os avisos que o pedido não confirmou', () => {
    const r = verificarPrompt({ rascunho: 'Voce e a Aurora.', publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(avisosNaoConfirmados(r, ['perdeu:contactName'])).toEqual(['perdeu:conversationStageContext', 'perdeu:replyText']);
    expect(avisosNaoConfirmados(r, codigos(r.avisos))).toEqual([]);
  });

  it('os prompts de hoje: a Aurora não dispara nada; a Julia mostra só a informação do encerramento', () => {
    const aurora = verificarPrompt({ rascunho: AURORA, publicado: AURORA, numerosLigadosComAgenda: 1 });
    expect(aurora).toEqual({ erros: [], avisos: [], informacoes: [] });

    const julia = verificarPrompt({ rascunho: JULIA, publicado: JULIA, numerosLigadosComAgenda: 0 });
    expect(julia.erros).toEqual([]);
    expect(julia.avisos).toEqual([]);
    expect(codigos(julia.informacoes)).toEqual(['sem_encerramento']);
  });

  it('o padrão neutro (07/10) não tem erro nem aviso: só a informação do encerramento, como a Julia', () => {
    const padrao = verificarPrompt({ rascunho: PADRAO, publicado: PADRAO, numerosLigadosComAgenda: 0 });
    expect(padrao.erros).toEqual([]);
    expect(padrao.avisos).toEqual([]);
    expect(codigos(padrao.informacoes)).toEqual(['sem_encerramento']);
  });

  it('a Aurora antes de ser ligada a um número com agenda: só o aviso da agenda', () => {
    expect(codigos(verificarPrompt({ rascunho: AURORA, publicado: AURORA, numerosLigadosComAgenda: 0 }).avisos)).toEqual(['agenda_sem_numero']);
  });
});
