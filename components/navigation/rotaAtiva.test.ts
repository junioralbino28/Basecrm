import { describe, expect, it } from 'vitest';
import { abreDetalheDoItem } from './rotaAtiva';

describe('item do menu aceso na tela de detalhe', () => {
  const lista = '/platform/tenants/t1/agents';

  it('acende "Agentes" no editor de um agente', () => {
    expect(abreDetalheDoItem('/platform/tenants/t1/agents/a1', lista)).toBe(true);
  });

  it('não acende em caminho que só começa igual, em outra lista nem na própria lista (essa é igualdade exata)', () => {
    expect(abreDetalheDoItem('/platform/tenants/t1/agentsx', lista)).toBe(false);
    expect(abreDetalheDoItem('/platform/tenants/t1/automations/x', '/platform/tenants/t1/automations')).toBe(false);
    expect(abreDetalheDoItem(lista, lista)).toBe(false);
  });
});
