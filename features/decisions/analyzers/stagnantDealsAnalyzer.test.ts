import { describe, expect, it } from 'vitest';
import type { Activity, DealView } from '@/types';
import { analyzeStagnantDeals } from './stagnantDealsAnalyzer';

const DIA = 24 * 60 * 60 * 1000;

describe('analyzeStagnantDeals — título histórico da última atividade (revisão do Codex, 07/10)', () => {
  it('a justificativa e a atividade sugerida mostram "Lead criado", nunca o "Paciente Criado" gravado', () => {
    const deal = {
      id: 'deal-1', title: 'Fulano', status: 'OPEN', value: 1000, companyName: 'Empresa', stageLabel: 'Novo',
      contactId: 'contato-1', contactName: 'Fulano', contactEmail: '',
    } as unknown as DealView;
    const atividade = {
      id: 'atv-1', dealId: 'deal-1', dealTitle: 'Fulano', type: 'TASK', title: 'Paciente Criado',
      date: new Date(Date.now() - 10 * DIA).toISOString(), completed: true, user: { name: 'Sistema', avatar: '' },
    } as unknown as Activity;

    const [decisao] = analyzeStagnantDeals([deal], [atividade]).decisions;

    expect(decisao.reasoning).toContain('"Lead criado"');
    expect(JSON.stringify(decisao.suggestedAction)).toContain('última atividade: Lead criado');
    expect(JSON.stringify(decisao)).not.toContain('Paciente');
  });
});
