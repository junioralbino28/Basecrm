import { describe, expect, it } from 'vitest';
import {
  conferirReplay,
  fingerprintDoPedido,
  warningDoReplay,
  type PedidoDeEnvio,
} from './idempotenciaManual';
import { PENDING_REVIEW_WARNING } from './dispatchConversationOutbound';

const PEDIDO: PedidoDeEnvio = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  threadId: '33333333-3333-4333-8333-333333333333',
  atorId: '44444444-4444-4444-8444-444444444444',
  direction: 'outbound',
  content: 'Oi, confirmo amanha as 14h',
  attachmentPath: null,
  sendExternal: true,
};

describe('fingerprintDoPedido: o mesmo pedido tem sempre a mesma cara', () => {
  it('e estavel para o mesmo pedido', () => {
    expect(fingerprintDoPedido(PEDIDO)).toBe(fingerprintDoPedido({ ...PEDIDO }));
  });

  it('muda quando QUALQUER campo do pedido logico muda', () => {
    const base = fingerprintDoPedido(PEDIDO);
    expect(fingerprintDoPedido({ ...PEDIDO, content: 'outro texto' })).not.toBe(base);
    expect(fingerprintDoPedido({ ...PEDIDO, threadId: '99999999-9999-4999-8999-999999999999' })).not.toBe(base);
    expect(fingerprintDoPedido({ ...PEDIDO, atorId: '99999999-9999-4999-8999-999999999999' })).not.toBe(base);
    expect(fingerprintDoPedido({ ...PEDIDO, attachmentPath: 'tenant/foto.jpg' })).not.toBe(base);
    expect(fingerprintDoPedido({ ...PEDIDO, sendExternal: false })).not.toBe(base);
  });

  it('NAO depende de configuracao nem de nome: replay com o interruptor mudado e o mesmo pedido', () => {
    // O fingerprint so olha o pedido logico. Se a assinatura ligar entre a 1a tentativa e o
    // retry, o retry ainda devolve a tentativa original — nunca um segundo envio.
    expect(Object.keys(PEDIDO).sort()).toEqual([
      'atorId',
      'attachmentPath',
      'content',
      'direction',
      'organizationId',
      'sendExternal',
      'threadId',
    ]);
  });
});

describe('conferirReplay', () => {
  const linhaCom = (hash: string, extra: Record<string, unknown> = {}) => ({
    thread_id: PEDIDO.threadId,
    content: PEDIDO.content,
    metadata: { intencao: { versao: 1, hash } },
    ...extra,
  });

  it('hash igual = mesmo pedido', () => {
    expect(conferirReplay(linhaCom(fingerprintDoPedido(PEDIDO)), PEDIDO)).toBe('igual');
  });

  it('hash diferente = pedido diferente, mesmo que o texto pareca igual', () => {
    const outro = fingerprintDoPedido({ ...PEDIDO, atorId: 'outro-ator' });
    expect(conferirReplay(linhaCom(outro), PEDIDO)).toBe('diferente');
  });

  it('linha legada sem fingerprint: compara pela thread', () => {
    // So existe para chaves antigas geradas no servidor (manual:<uuid>), que nunca voltam num
    // segundo POST — ramo praticamente morto, mantido para nao tratar legado como conflito.
    expect(conferirReplay({ thread_id: PEDIDO.threadId, content: 'x', metadata: {} }, PEDIDO)).toBe('igual');
    expect(
      conferirReplay({ thread_id: 'outra-thread', content: PEDIDO.content, metadata: null }, PEDIDO),
    ).toBe('diferente');
  });

  it('metadata forjado sem hash string nao passa por fingerprint', () => {
    expect(
      conferirReplay({ thread_id: PEDIDO.threadId, content: '', metadata: { intencao: { hash: 42 } } }, PEDIDO),
    ).toBe('igual');
  });
});

describe('warningDoReplay: o aviso diz o estado real da tentativa anterior', () => {
  it('pending reutiliza a frase do dispatcher — revisao obrigatoria, nunca reenvio cego', () => {
    expect(warningDoReplay('pending', null)).toBe(PENDING_REVIEW_WARNING);
  });

  it('failed devolve o erro gravado, com fallback claro', () => {
    expect(warningDoReplay('failed', 'timeout na Evolution')).toBe('timeout na Evolution');
    expect(warningDoReplay('failed', null)).toBe('A tentativa anterior falhou antes de chegar ao WhatsApp.');
  });

  it('unknown avisa que nao ha confirmacao', () => {
    expect(warningDoReplay('unknown', null)).toBe('Entrega não confirmada pela Evolution.');
  });

  it('sent nao gera aviso', () => {
    expect(warningDoReplay('sent', null)).toBeNull();
    expect(warningDoReplay(null, null)).toBeNull();
  });
});
