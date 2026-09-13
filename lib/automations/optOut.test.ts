import { describe, expect, it } from 'vitest';
import { detectAutomationOptOut, normalizeOptOutText } from './optOut';

describe('2c — palavra de parada (opt-out de automações)', () => {
  it('reconhece a palavra sozinha, com acento, pontuação, emoji e caixa diferente', () => {
    expect(detectAutomationOptOut('PARAR')).toBe('PARAR');
    expect(detectAutomationOptOut('parar')).toBe('PARAR');
    expect(detectAutomationOptOut('  Parar!!! ')).toBe('PARAR');
    expect(detectAutomationOptOut('sair 🙏')).toBe('SAIR');
    expect(detectAutomationOptOut('Não quero receber.')).toBe('NAO QUERO RECEBER');
    expect(detectAutomationOptOut('me tira da lista')).toBe('ME TIRA DA LISTA');
    expect(detectAutomationOptOut('STOP')).toBe('STOP');
  });

  it('não cala a conversa por uma palavra no meio de uma frase', () => {
    expect(detectAutomationOptOut('quero parar de fumar, tem tratamento?')).toBeNull();
    expect(detectAutomationOptOut('para quando tem horário?')).toBeNull();
    expect(detectAutomationOptOut('para')).toBeNull();
    expect(detectAutomationOptOut('cancelar a consulta de amanhã')).toBeNull();
    expect(detectAutomationOptOut('')).toBeNull();
    expect(detectAutomationOptOut(null)).toBeNull();
  });

  it('ignora textos longos mesmo que comecem com a palavra', () => {
    expect(detectAutomationOptOut('parar ' + 'x'.repeat(60))).toBeNull();
  });

  it('normaliza tirando acento, pontuação e espaços repetidos', () => {
    expect(normalizeOptOutText('  Não   quero,   mais! ')).toBe('NAO QUERO MAIS');
  });
});
