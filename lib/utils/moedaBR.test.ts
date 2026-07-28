import { describe, expect, it } from 'vitest';
import { mascararMoedaBR, paraNumeroBR, paraCampoMoedaBR } from './moedaBR';

/**
 * Digitação de dinheiro no padrão brasileiro (Junior, 2026-07-27):
 * vírgula no decimal, os dois decimais contando sozinhos, e sem precisar apagar
 * o zero que já está no campo.
 */
describe('mascararMoedaBR — os centavos entram pela direita', () => {
  it('o primeiro dígito vira centavo', () => {
    expect(mascararMoedaBR('1')).toBe('0,01');
  });

  it('os dígitos empurram a vírgula', () => {
    expect(mascararMoedaBR('15')).toBe('0,15');
    expect(mascararMoedaBR('150')).toBe('1,50');
    expect(mascararMoedaBR('12345')).toBe('123,45');
  });

  it('põe separador de milhar', () => {
    expect(mascararMoedaBR('123456')).toBe('1.234,56');
    expect(mascararMoedaBR('1234567890')).toBe('12.345.678,90');
  });

  it('ninguém precisa apagar o zero que já estava lá', () => {
    // Campo em "0,00" e a pessoa digita 5 → o valor do input vira "0,005".
    expect(mascararMoedaBR('0,005')).toBe('0,05');
  });

  it('campo vazio continua vazio (pro placeholder aparecer)', () => {
    expect(mascararMoedaBR('')).toBe('');
    expect(mascararMoedaBR('abc')).toBe('');
  });
});

describe('paraNumeroBR — vírgula é decimal, ponto é milhar', () => {
  it('lê o formato brasileiro', () => {
    expect(paraNumeroBR('1.234,56')).toBe(1234.56);
    expect(paraNumeroBR('0,05')).toBe(0.05);
    expect(paraNumeroBR('123,45')).toBe(123.45);
  });

  it('aceita ponto decimal — valor do banco ou de importação chega assim', () => {
    expect(paraNumeroBR('1234.56')).toBe(1234.56);
    expect(paraNumeroBR(980)).toBe(980);
  });

  it('vazio ou lixo vira zero, nunca NaN', () => {
    expect(paraNumeroBR('')).toBe(0);
    expect(paraNumeroBR(null)).toBe(0);
    expect(paraNumeroBR('abc')).toBe(0);
  });
});

describe('paraCampoMoedaBR — número volta pro campo', () => {
  it('formata com dois decimais', () => {
    expect(paraCampoMoedaBR(1234.5)).toBe('1.234,50');
    expect(paraCampoMoedaBR(0.05)).toBe('0,05');
  });

  it('zero vira campo vazio', () => {
    expect(paraCampoMoedaBR(0)).toBe('');
    expect(paraCampoMoedaBR(null)).toBe('');
  });

  it('ida e volta preserva o valor', () => {
    expect(paraNumeroBR(paraCampoMoedaBR(4567.89))).toBe(4567.89);
  });
});
