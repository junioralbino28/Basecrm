import { describe, expect, it } from 'vitest';
import { toFriendlyAutomationError } from './automationErrorMessages';

describe('toFriendlyAutomationError', () => {
  it('traduz caso do switch sem valor pra linguagem leiga (report do Junior)', () => {
    const friendly = toFriendlyAutomationError(
      'config inválida em switch: cases.0.value operador contains exige value',
    );

    expect(friendly).toContain('Dividir caminho');
    expect(friendly).toContain('caminho nº 1');
    expect(friendly).toContain('sem valor de comparação');
    expect(friendly).toContain('detalhe técnico');
  });

  it('traduz passo inválido genérico com o nome amigável do passo', () => {
    const friendly = toFriendlyAutomationError(
      'config inválida em send_message: body_local vazio',
    );

    expect(friendly).toContain('Envia · WhatsApp');
    expect(friendly).toContain('está incompleto');
  });

  it('deixa passar mensagens que já são legíveis', () => {
    expect(toFriendlyAutomationError('Falha ao salvar rascunho.')).toBe(
      'Falha ao salvar rascunho.',
    );
  });
});
