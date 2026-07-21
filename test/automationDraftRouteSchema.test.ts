import { describe, expect, it } from 'vitest';
import { AutomationDraftHttpSchema } from '@/app/api/platform/tenants/[tenantId]/automations/[automationId]/route';

const FROM = '11111111-1111-4111-8111-111111111111';
const TO = '22222222-2222-4222-8222-222222222222';
const CASE_ID = '33333333-3333-4333-8333-333333333333';

function draftWithOutcome(outcome: string) {
  return {
    name: 'Fluxo com divisão',
    draftRevision: 1,
    triggerConfig: {},
    steps: [
      { stepKey: FROM, stepType: 'switch', config: {}, sortKey: 0 },
      { stepKey: TO, stepType: 'create_task', config: {}, sortKey: 1 },
    ],
    edges: [{
      fromStepKey: FROM,
      outcome,
      toStepKey: TO,
      order: 0,
    }],
  };
}

describe('schema HTTP do rascunho de automação', () => {
  it('aceita outcome case:<uuid> produzido pelo editor e pelo compilador', () => {
    expect(AutomationDraftHttpSchema.safeParse(
      draftWithOutcome(`case:${CASE_ID}`),
    ).success).toBe(true);
  });

  it.each([
    'case:sem-uuid',
    'case:33333333-3333-3333-3333-333333333333:extra',
    'qualquer-coisa',
  ])('continua recusando outcome fora do contrato: %s', (outcome) => {
    expect(AutomationDraftHttpSchema.safeParse(draftWithOutcome(outcome)).success)
      .toBe(false);
  });
});
