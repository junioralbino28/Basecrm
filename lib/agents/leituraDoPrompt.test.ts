// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import { dividirEmSecoes, juntarSecoes, pedacosDaLinha } from './leituraDoPrompt';

const catalogo = getPromptCatalogMap() as Record<string, { defaultTemplate: string }>;
const AURORA = catalogo.task_conversations_whatsapp_cenno_aurora.defaultTemplate;
const JULIA = catalogo.task_conversations_whatsapp_auto_reply.defaultTemplate;

describe('leitura formatada do prompt', () => {
  it('divide a Aurora e a Julia pelos títulos em maiúscula, com a abertura antes do primeiro', () => {
    expect(dividirEmSecoes(AURORA).map((s) => s.titulo)).toEqual([
      null,
      'O QUE A CENOURA HUB FAZ',
      'REGRAS DE CONVERSA',
      'GATE DE CAPACIDADE E CONSULTORIA',
      'ETIQUETAS DO FUNIL',
      'CONTATO POR ENGANO',
      'CONVERSA ENCERRADA',
      'OBJETIVO E REUNIAO',
      'ENCERRAMENTO',
      'CONTEXTO',
      'HISTORICO RECENTE',
      'RETORNE APENAS UM OBJETO COM',
    ]);
    expect(dividirEmSecoes(JULIA).map((s) => s.titulo)).toEqual([
      null,
      'REGRAS',
      'QUEBRA DE OBJECAO DE AVALIACAO PAGA',
      'CONTEXTO',
      'HISTORICO RECENTE',
      'RETORNE APENAS UM OBJETO COM',
    ]);
  });

  it('separa a nota entre parênteses e o texto que vem depois dos dois-pontos', () => {
    const [, secao] = dividirEmSecoes('Abertura\nETIQUETAS DO FUNIL (decisao de 27/09): use so as do catalogo\n- Respondeu');
    expect(secao).toMatchObject({
      titulo: 'ETIQUETAS DO FUNIL',
      nota: 'decisao de 27/09',
      complemento: 'use so as do catalogo',
      linhas: ['- Respondeu'],
    });
  });

  it('não perde nada: juntar as seções devolve o texto original, byte a byte', () => {
    for (const texto of [AURORA, JULIA, '', 'REGRAS:\n- uma', 'sem titulo nenhum\n\n']) {
      expect(juntarSecoes(dividirEmSecoes(texto))).toBe(texto);
    }
  });

  it('marca as variáveis da linha, conhecidas e desconhecidas', () => {
    expect(pedacosDaLinha('Oferece {{calendarContext}} e {{ nomeErrado }}.')).toEqual([
      { tipo: 'texto', texto: 'Oferece ' },
      { tipo: 'variavel', texto: '{{calendarContext}}', nome: 'calendarContext', conhecida: true },
      { tipo: 'texto', texto: ' e ' },
      { tipo: 'variavel', texto: '{{ nomeErrado }}', nome: 'nomeErrado', conhecida: false },
      { tipo: 'texto', texto: '.' },
    ]);
    expect(pedacosDaLinha('')).toEqual([]);
  });
});
