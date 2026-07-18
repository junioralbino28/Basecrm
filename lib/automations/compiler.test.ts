import { describe, expect, it } from 'vitest';
import {
  AutomationCompileError,
  compileAutomationDefinition,
  type AutomationCompileInput,
} from './compiler';

const IDS = {
  automation: '10000000-0000-4000-8000-000000000001',
  organization: '10000000-0000-4000-8000-000000000002',
  send: '10000000-0000-4000-8000-000000000003',
  wait: '10000000-0000-4000-8000-000000000004',
  answered: '10000000-0000-4000-8000-000000000005',
  timeout: '10000000-0000-4000-8000-000000000006',
  template: '10000000-0000-4000-8000-000000000007',
} as const;

function validInput(): AutomationCompileInput {
  return {
    automation: {
      id: IDS.automation,
      organizationId: IDS.organization,
      name: 'Follow-up principal',
      deliveryMode: 'simulation',
      triggerType: 'tag_added',
      triggerConfig: { tag: 'follow-up' },
      draftRevision: 4,
    },
    schedule: {
      timezone: 'America/Sao_Paulo',
      quietHoursStart: '20:00:00',
      quietHoursEnd: '08:00:00',
      dayDelaySemantics: 'next_local_day',
    },
    templates: [
      {
        id: IDS.template,
        organizationId: IDS.organization,
        revision: 3,
        channel: 'whatsapp',
        body: 'Olá {{ contato.primeiro_nome | default: "tudo bem" }}',
        mediaAssetVariantId: null,
      },
    ],
    steps: [
      {
        id: IDS.send,
        stepKey: '20000000-0000-4000-8000-000000000001',
        stepType: 'send_message',
        sortKey: 0,
        config: {
          link_mode: 'linked',
          template_id: IDS.template,
          message_kind: 'text',
        },
      },
      {
        id: IDS.wait,
        stepKey: '20000000-0000-4000-8000-000000000002',
        stepType: 'wait_for_event',
        sortKey: 1,
        config: { timeout_amount: 2, timeout_unit: 'days' },
      },
      {
        id: IDS.answered,
        stepKey: '20000000-0000-4000-8000-000000000003',
        stepType: 'create_task',
        sortKey: 2,
        config: { title: 'Responder lead' },
      },
      {
        id: IDS.timeout,
        stepKey: '20000000-0000-4000-8000-000000000004',
        stepType: 'create_task',
        sortKey: 3,
        config: { title: 'Retomar follow-up' },
      },
    ],
    edges: [
      {
        fromStepId: IDS.send,
        outcome: 'success',
        toStepId: IDS.wait,
        order: 0,
      },
      {
        fromStepId: IDS.wait,
        outcome: 'answered',
        toStepId: IDS.answered,
        order: 0,
      },
      {
        fromStepId: IDS.wait,
        outcome: 'timeout',
        toStepId: IDS.timeout,
        order: 1,
      },
    ],
  };
}

describe('compileAutomationDefinition', () => {
  it('gera definição canônica, hash estável e snapshot do template linked', () => {
    const input = validInput();
    const first = compileAutomationDefinition(input);
    const second = compileAutomationDefinition({
      ...input,
      steps: [...input.steps].reverse(),
      edges: [...input.edges].reverse(),
    });

    expect(first.definitionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.definitionHash).toBe(first.definitionHash);
    expect(second.canonicalJson).toBe(first.canonicalJson);
    expect(first.definition.entryStepKey).toBe(
      '20000000-0000-4000-8000-000000000001'
    );
    expect(first.definition.schedule.dayDelaySemantics).toBe('next_local_day');

    const send = first.definition.steps.find((step) => step.type === 'send_message');
    expect(send?.config).toMatchObject({
      body: 'Olá {{ contato.primeiro_nome | default: "tudo bem" }}',
      linkMode: 'linked',
      templateId: IDS.template,
      templateRevision: 3,
      variables: ['contato.primeiro_nome'],
    });
  });

  it('rejeita variável desconhecida e token sem fallback', () => {
    const unknown = validInput();
    unknown.templates[0].body = 'Olá {{ contato.apelido | default: "pessoa" }}';
    expect(() => compileAutomationDefinition(unknown)).toThrowError(
      /variável desconhecida: contato\.apelido/
    );

    const withoutFallback = validInput();
    withoutFallback.templates[0].body = 'Olá {{ contato.primeiro_nome }}';
    expect(() => compileAutomationDefinition(withoutFallback)).toThrowError(
      /fallback obrigatório/
    );
  });

  it('rejeita passo órfão, ciclo e outcome incompatível', () => {
    const orphan = validInput();
    orphan.edges = orphan.edges.filter((edge) => edge.toStepId !== IDS.timeout);
    expect(() => compileAutomationDefinition(orphan)).toThrowError(/passo órfão/);

    const cycle = validInput();
    cycle.edges.push({
      fromStepId: IDS.answered,
      outcome: 'success',
      toStepId: IDS.send,
      order: 0,
    });
    expect(() => compileAutomationDefinition(cycle)).toThrowError(/ciclo/);

    const badOutcome = validInput();
    badOutcome.edges[0].outcome = 'answered';
    expect(() => compileAutomationDefinition(badOutcome)).toThrowError(
      /outcome answered inválido para send_message/
    );
  });

  it('exige os caminhos answered e timeout em wait_for_event', () => {
    const input = validInput();
    input.edges = input.edges.filter((edge) => edge.outcome !== 'timeout');
    input.steps = input.steps.filter((step) => step.id !== IDS.timeout);

    expect(() => compileAutomationDefinition(input)).toThrowError(
      /wait_for_event exige os outcomes answered e timeout/
    );
  });

  it('retorna erros tipados com o stepKey responsável', () => {
    const input = validInput();
    input.steps[0].config = {
      link_mode: 'linked',
      template_id: '30000000-0000-4000-8000-000000000001',
      message_kind: 'text',
    };

    try {
      compileAutomationDefinition(input);
      throw new Error('deveria falhar');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationCompileError);
      expect((error as AutomationCompileError).issues[0].stepKey).toBe(
        input.steps[0].stepKey
      );
    }
  });
});
