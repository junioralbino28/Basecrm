import { describe, expect, it } from 'vitest';
import { descreverVersao, formatarDataHora } from './formatos';

const base = { id: 'v', nota: null, publicadaEm: '2026-10-07T04:51:00Z' };

describe('formatos do editor', () => {
  it('mostra a hora de Brasília, não a UTC do banco', () => {
    expect(formatarDataHora('2026-10-07T04:51:00Z')).toBe('07/10/2026 às 01:51');
    expect(formatarDataHora('2026-10-07T03:05:00Z')).toBe('07/10/2026 às 00:05');
  });

  it('descreve a versão do jeito da SPEC: "Versão N publicada em [data] por [pessoa]"', () => {
    expect(descreverVersao({ ...base, versao: 1, origem: 'migration', restauradaDe: null, publicadaPor: null }))
      .toBe('Versão 1 publicada em 07/10/2026 às 01:51 pela migração');
    expect(descreverVersao({ ...base, versao: 2, origem: 'publish', restauradaDe: null, publicadaPor: 'Junior' }))
      .toBe('Versão 2 publicada em 07/10/2026 às 01:51 por Junior');
    expect(descreverVersao({ ...base, versao: 3, origem: 'restore', restauradaDe: 1, publicadaPor: 'Junior' }))
      .toBe('Versão 3 (restaurada da versão 1) publicada em 07/10/2026 às 01:51 por Junior');
    expect(descreverVersao({ ...base, versao: 4, origem: 'publish', restauradaDe: null, publicadaPor: null }))
      .toBe('Versão 4 publicada em 07/10/2026 às 01:51 por alguém que saiu da equipe');
  });
});
