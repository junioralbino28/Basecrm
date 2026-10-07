import { describe, expect, it } from 'vitest';
import { compararAjustes, compararLinhas } from './compararVersoes';

describe('compararLinhas', () => {
  it('texto igual: todas as linhas iguais', () => {
    expect(compararLinhas('a\nb', 'a\nb')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'igual', texto: 'b' },
    ]);
  });

  it('linha trocada vira removida e adicionada, no lugar', () => {
    expect(compararLinhas('a\nb\nc', 'a\nX\nc')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'removida', texto: 'b' },
      { tipo: 'adicionada', texto: 'X' },
      { tipo: 'igual', texto: 'c' },
    ]);
  });

  it('linha removida no meio e linha acrescentada no fim', () => {
    expect(compararLinhas('a\nb\nc', 'a\nc')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'removida', texto: 'b' },
      { tipo: 'igual', texto: 'c' },
    ]);
    expect(compararLinhas('a', 'a\nb')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'adicionada', texto: 'b' },
    ]);
  });

  it('grande demais para comparar na tela: devolve null', () => {
    const grande = 'x\n'.repeat(2001);
    expect(compararLinhas(grande, `${grande}y`)).toBeNull();
  });
});

describe('compararAjustes', () => {
  it('ajustes e modelo iguais: nenhuma diferença', () => {
    expect(compararAjustes({ ajustes: {}, modelo: null }, { ajustes: {}, modelo: null })).toEqual([]);
  });

  it('mostra campo a campo o que mudou, e o modelo', () => {
    expect(compararAjustes(
      { ajustes: { dividir: { partes: 3 } }, modelo: null },
      { ajustes: { dividir: { partes: 2 }, agrupar: { segundos: 7 } }, modelo: 'modelo-x' },
    )).toEqual([
      { campo: 'agrupar', antes: '(sem valor)', depois: '{"segundos":7}' },
      { campo: 'dividir', antes: '{"partes":3}', depois: '{"partes":2}' },
      { campo: 'modelo', antes: 'o padrão da organização', depois: 'modelo-x' },
    ]);
  });
});
