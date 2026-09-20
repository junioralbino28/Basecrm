import { describe, expect, it } from 'vitest';
import { getNewHighPrioritySystemAlerts } from './systemAlerts';

const alerts = [
  {
    id: 'handoff-1',
    severity: 'high' as const,
    readAt: null,
    title: 'Lead aceitou ligacao',
    message: 'Marina quer falar agora.',
    actionLink: '/conversations',
  },
  {
    id: 'info-1',
    severity: 'low' as const,
    readAt: null,
    title: 'Informacao',
    message: 'Sem urgencia.',
    actionLink: undefined,
  },
];

describe('system notification browser alerts', () => {
  it('nao dispara o estoque antigo na primeira leitura', () => {
    expect(getNewHighPrioritySystemAlerts(null, alerts)).toEqual([]);
  });

  it('dispara apenas alerta alto, nao lido e ainda nao observado', () => {
    expect(getNewHighPrioritySystemAlerts(new Set(['info-1']), alerts)).toEqual([alerts[0]]);
  });

  it('nao repete alerta ja observado ou lido', () => {
    expect(getNewHighPrioritySystemAlerts(new Set(['handoff-1']), alerts)).toEqual([]);
    expect(
      getNewHighPrioritySystemAlerts(new Set(), [{ ...alerts[0], readAt: '2026-09-19T14:00:00Z' }])
    ).toEqual([]);
  });
});
