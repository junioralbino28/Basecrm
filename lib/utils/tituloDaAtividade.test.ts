import { describe, expect, it } from 'vitest';
import { tituloDaAtividade } from './tituloDaAtividade';

describe('tituloDaAtividade', () => {
  it('o título histórico gravado no banco aparece com o termo neutro', () => {
    expect(tituloDaAtividade('Paciente Criado')).toBe('Lead criado');
  });

  it('qualquer outro título passa igual', () => {
    expect(tituloDaAtividade('Ligar amanhã cedo')).toBe('Ligar amanhã cedo');
    expect(tituloDaAtividade('')).toBe('');
    // Nome de propriedade de objeto não pode virar tradução.
    expect(tituloDaAtividade('toString')).toBe('toString');
  });
});
