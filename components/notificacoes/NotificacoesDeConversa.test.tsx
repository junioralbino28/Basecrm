// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  resumirNaoLidas,
  conversasQueGanharamMensagem,
  formatarHoraBR,
  lerPreferencias,
  salvarPreferencias,
} from './NotificacoesDeConversa';

/**
 * Notificação de mensagem (Junior, 28/07): "chega a mensagem, mas não notifica
 * em lugar nenhum no CRM". A regra central testada aqui: só notifica a conversa
 * que GANHOU mensagem desde a última foto — nunca o estoque antigo de
 * não-lidas ao abrir/recarregar a página.
 */
describe('resumirNaoLidas', () => {
  it('conta só as conversas com mensagem não vista, com nome, prévia e hora', () => {
    const resumo = resumirNaoLidas([
      {
        id: 'a', contact_name: 'Junior', unread_count: 2,
        last_message_preview: 'oi', last_message_sent_at: '2026-07-28T16:24:42.000Z',
      },
      { id: 'b', contact_name: 'Maria', unread_count: 0, last_message_preview: 'ok' },
      {
        id: 'c', contact_name: null, contact: { name: 'Adel' }, unread_count: 1,
        last_message_preview: null, last_message_sent_at: '2026-07-28T15:00:00.000Z',
      },
    ]);

    expect(resumo.totalConversas).toBe(2); // a bolinha conta CONVERSAS, como no WhatsApp
    expect(resumo.totalMensagens).toBe(3);
    expect(resumo.ultimaHora).toBe('2026-07-28T16:24:42.000Z');
    expect(resumo.conversas.map((c) => c.nome)).toEqual(['Junior', 'Adel']);
    expect(resumo.conversas[1].previa).toBe('Nova mensagem'); // sem prévia não fica vazio
  });
});

describe('conversasQueGanharamMensagem', () => {
  const resumo = resumirNaoLidas([
    { id: 'a', contact_name: 'Junior', unread_count: 3 },
    { id: 'b', contact_name: 'Maria', unread_count: 1 },
  ]);

  it('primeira foto (abrir a página) NÃO notifica o estoque antigo', () => {
    expect(conversasQueGanharamMensagem(null, resumo)).toEqual([]);
  });

  it('só a conversa cujo contador SUBIU notifica', () => {
    const antes = new Map([['a', 2], ['b', 1]]);
    const novas = conversasQueGanharamMensagem(antes, resumo);
    expect(novas.map((c) => c.id)).toEqual(['a']);
  });

  it('conversa nova (não estava na foto) notifica', () => {
    const antes = new Map([['a', 3]]);
    const novas = conversasQueGanharamMensagem(antes, resumo);
    expect(novas.map((c) => c.id)).toEqual(['b']);
  });
});

describe('preferências por usuário (notificação e som ligam/desligam separados)', () => {
  it('padrão: notificação e som ligados; salvar e ler devolve o que foi salvo', () => {
    expect(lerPreferencias('user-1')).toEqual({ ativas: true, som: true });

    salvarPreferencias('user-1', { ativas: true, som: false });
    expect(lerPreferencias('user-1')).toEqual({ ativas: true, som: false });

    // outro usuário no mesmo navegador não herda a escolha
    expect(lerPreferencias('user-2')).toEqual({ ativas: true, som: true });
  });
});

describe('formatarHoraBR', () => {
  it('hora curta pra tooltip e corpo da notificação; lixo vira vazio', () => {
    expect(formatarHoraBR('2026-07-28T16:24:42.000Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(formatarHoraBR(null)).toBe('');
    expect(formatarHoraBR('nao-e-data')).toBe('');
  });
});
