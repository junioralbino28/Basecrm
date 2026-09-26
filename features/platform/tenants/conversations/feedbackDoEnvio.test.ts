import { describe, expect, it } from 'vitest';
import { feedbackDoEnvio } from './feedbackDoEnvio';

/**
 * Falha e incerteza sao estados DIFERENTES e o operador age diferente em cada um:
 * "failed" nao chegou — pode reenviar; "unknown/pending" PODE ter chegado — reenviar as cegas
 * e o que duplica mensagem para o lead. O texto do feedback carrega essa diferenca.
 */

describe('feedbackDoEnvio', () => {
  it('nota interna: sucesso simples', () => {
    expect(feedbackDoEnvio({ oQue: 'nota', deliveryStatus: null, warning: null })).toEqual({
      kind: 'success',
      text: 'Nota interna registrada.',
    });
  });

  it('mensagem entregue: sucesso', () => {
    expect(feedbackDoEnvio({ oQue: 'mensagem', deliveryStatus: 'sent', warning: null })).toEqual({
      kind: 'success',
      text: 'Mensagem enviada e registrada na conversa humana.',
    });
  });

  it('anexo entregue: sucesso com o rotulo certo', () => {
    expect(feedbackDoEnvio({ oQue: 'anexo', deliveryStatus: 'sent', warning: null })).toEqual({
      kind: 'success',
      text: 'Anexo enviado.',
    });
  });

  it('falhou: diz que NAO chegou e que pode tentar de novo', () => {
    const feedback = feedbackDoEnvio({ oQue: 'mensagem', deliveryStatus: 'failed', warning: 'instancia desconectada' });
    expect(feedback.kind).toBe('warning');
    expect(feedback.text).toContain('não chegou');
    expect(feedback.text).toContain('instancia desconectada');
    expect(feedback.text).toContain('tentar de novo');
  });

  it('sem confirmacao: manda CONFERIR antes de reenviar — nunca diz que falhou', () => {
    for (const status of ['unknown', 'pending'] as const) {
      const feedback = feedbackDoEnvio({ oQue: 'mensagem', deliveryStatus: status, warning: null });
      expect(feedback.kind).toBe('warning');
      expect(feedback.text).toContain('Sem confirmação');
      expect(feedback.text).toContain('confira na conversa');
      expect(feedback.text.toLowerCase()).not.toContain('falhou');
    }
  });

  it('replay de mensagem ja enviada: avisa que nada foi reenviado', () => {
    const feedback = feedbackDoEnvio({ oQue: 'mensagem', deliveryStatus: 'sent', warning: null, replayed: true });
    expect(feedback.kind).toBe('success');
    expect(feedback.text).toContain('já tinha sido enviada');
    expect(feedback.text).toContain('nada foi reenviado');
  });

  it('replay de tentativa sem confirmacao continua mandando conferir', () => {
    const feedback = feedbackDoEnvio({
      oQue: 'mensagem',
      deliveryStatus: 'pending',
      warning: 'dispatch anterior permaneceu pending; revisão obrigatória',
      replayed: true,
    });
    expect(feedback.kind).toBe('warning');
    expect(feedback.text).toContain('confira na conversa');
  });

  it('sem status nenhum (envio apenas local): sucesso', () => {
    expect(feedbackDoEnvio({ oQue: 'mensagem', deliveryStatus: null, warning: null }).kind).toBe('success');
  });
});
