import { describe, it, expect } from 'vitest';
import { queryKeys } from './queryKeys';

describe('queryKeys.atendimentos', () => {
  it('expõe as keys padrão de entidade', () => {
    expect(queryKeys.atendimentos.all).toEqual(['atendimentos']);
    expect(queryKeys.atendimentos.lists()).toEqual(['atendimentos', 'list']);
  });
});
