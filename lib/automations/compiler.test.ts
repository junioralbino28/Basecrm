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
  switch: '10000000-0000-4000-8000-000000000008',
  switchCase1: '10000000-0000-4000-8000-000000000011',
  switchCase2: '10000000-0000-4000-8000-000000000012',
  switchCase3: '10000000-0000-4000-8000-000000000013',
  switchCase4: '10000000-0000-4000-8000-000000000014',
  switchTarget1: '10000000-0000-4000-8000-000000000021',
  switchTarget2: '10000000-0000-4000-8000-000000000022',
  switchTarget3: '10000000-0000-4000-8000-000000000023',
  switchTarget4: '10000000-0000-4000-8000-000000000024',
  switchFallback: '10000000-0000-4000-8000-000000000025',
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

function validSwitchInput(): AutomationCompileInput {
  const input = validInput();
  const caseIds = [
    IDS.switchCase1,
    IDS.switchCase2,
    IDS.switchCase3,
    IDS.switchCase4,
  ];
  const targetIds = [
    IDS.switchTarget1,
    IDS.switchTarget2,
    IDS.switchTarget3,
    IDS.switchTarget4,
  ];

  input.steps = [
    {
      id: IDS.switch,
      stepKey: '20000000-0000-4000-8000-000000000010',
      stepType: 'switch',
      sortKey: 0,
      config: {
        field: 'contact.tags',
        cases: caseIds.map((caseId, order) => ({
          case_id: caseId,
          label: `Serviço ${order + 1}`,
          operator: 'contains',
          value: `servico-${order + 1}`,
          order,
        })),
        fallback_label: 'Não identificado',
      },
    },
    ...targetIds.map((id, index) => ({
      id,
      stepKey: `20000000-0000-4000-8000-00000000002${index + 1}`,
      stepType: 'create_task' as const,
      sortKey: index + 1,
      config: { title: `Atender serviço ${index + 1}` },
    })),
    {
      id: IDS.switchFallback,
      stepKey: '20000000-0000-4000-8000-000000000025',
      stepType: 'create_task',
      sortKey: 5,
      config: { title: 'Qualificar serviço' },
    },
  ];
  input.edges = [
    ...caseIds.map((caseId, index) => ({
      fromStepId: IDS.switch,
      outcome: `case:${caseId}`,
      toStepId: targetIds[index],
      order: index,
    })),
    {
      fromStepId: IDS.switch,
      outcome: 'otherwise',
      toStepId: IDS.switchFallback,
      order: 4,
    },
  ];
  return input;
}

function issueCodes(input: AutomationCompileInput): string[] {
  try {
    compileAutomationDefinition(input);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(AutomationCompileError);
    return (error as AutomationCompileError).issues.map(({ code }) => code);
  }
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

  it('rejeita convergência porque o builder v1 exige pai único', () => {
    const input = validInput();
    input.edges.push({
      fromStepId: IDS.answered,
      outcome: 'success',
      toStepId: IDS.timeout,
      order: 0,
    });

    expect(issueCodes(input)).toContain('multiple_parents');
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

  it('compila switch com quatro casos e fallback em ordem determinística', () => {
    const input = validSwitchInput();
    const first = compileAutomationDefinition(input);
    const switchStep = first.definition.steps.find((step) => step.type === 'switch');

    expect(switchStep?.config.cases).toHaveLength(4);
    expect(first.definition.edges.map(({ outcome }) => outcome)).toEqual([
      `case:${IDS.switchCase1}`,
      `case:${IDS.switchCase2}`,
      `case:${IDS.switchCase3}`,
      `case:${IDS.switchCase4}`,
      'otherwise',
    ]);

    const reordered = validSwitchInput();
    reordered.steps[0].config.cases = [
      ...(reordered.steps[0].config.cases as unknown[]),
    ].reverse();
    expect(compileAutomationDefinition(reordered).definitionHash).toBe(
      first.definitionHash,
    );
  });

  it('recusa IDs e ordens de casos duplicados', () => {
    const duplicateId = validSwitchInput();
    const duplicateIdCases = duplicateId.steps[0].config.cases as Array<
      Record<string, unknown>
    >;
    duplicateIdCases[1].case_id = duplicateIdCases[0].case_id;
    expect(issueCodes(duplicateId)).toContain('switch_case_duplicate');

    const duplicateOrder = validSwitchInput();
    const duplicateOrderCases = duplicateOrder.steps[0].config.cases as Array<
      Record<string, unknown>
    >;
    duplicateOrderCases[1].order = duplicateOrderCases[0].order;
    expect(issueCodes(duplicateOrder)).toContain('switch_case_duplicate');
  });

  it('exige bijeção entre casos e arestas case:<id>', () => {
    const missing = validSwitchInput();
    missing.edges = missing.edges.filter(
      ({ outcome }) => outcome !== `case:${IDS.switchCase4}`,
    );
    expect(issueCodes(missing)).toContain('switch_case_edge_mismatch');

    const unknown = validSwitchInput();
    unknown.edges[0].outcome = `case:${IDS.template}`;
    expect(issueCodes(unknown)).toContain('switch_case_edge_mismatch');
  });

  it('exige exatamente um caminho otherwise', () => {
    const input = validSwitchInput();
    input.edges = input.edges.filter(({ outcome }) => outcome !== 'otherwise');

    expect(issueCodes(input)).toContain('switch_missing_otherwise');
  });

  it('não libera outcome dinâmico para outros tipos de passo', () => {
    const input = validInput();
    input.edges[0].outcome = `case:${IDS.switchCase1}`;

    expect(issueCodes(input)).toContain('dynamic_outcome_not_allowed');
  });

  it('recusa ordem duplicada entre arestas do mesmo pai', () => {
    const input = validSwitchInput();
    input.edges[1].order = input.edges[0].order;

    expect(issueCodes(input)).toContain('duplicate_edge_order');
  });

  it('valida compatibilidade de campo, operador e valor do switch', () => {
    const input = validSwitchInput();
    const cases = input.steps[0].config.cases as Array<Record<string, unknown>>;
    input.steps[0].config.field = 'deal.stage_id';
    cases[0].operator = 'contains';
    cases[0].value = 'não-é-uuid';

    expect(() => compileAutomationDefinition(input)).toThrowError(
      /config inválida em switch/i,
    );
  });

  it('limita quantidade e tamanho e exige rótulos visíveis', () => {
    const emptyLabel = validSwitchInput();
    const emptyCases = emptyLabel.steps[0].config.cases as Array<
      Record<string, unknown>
    >;
    emptyCases[0].label = '   ';
    expect(() => compileAutomationDefinition(emptyLabel)).toThrowError(
      /config inválida em switch/i,
    );

    const longLabel = validSwitchInput();
    const longCases = longLabel.steps[0].config.cases as Array<
      Record<string, unknown>
    >;
    longCases[0].label = 'x'.repeat(81);
    expect(() => compileAutomationDefinition(longLabel)).toThrowError(
      /config inválida em switch/i,
    );

    const tooMany = validSwitchInput();
    const sourceCases = tooMany.steps[0].config.cases as Array<
      Record<string, unknown>
    >;
    tooMany.steps[0].config.cases = Array.from({ length: 21 }, (_, index) => ({
      ...sourceCases[0],
      case_id: `10000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      label: `Caminho ${index + 1}`,
      value: `valor-${index + 1}`,
      order: index,
    }));
    expect(() => compileAutomationDefinition(tooMany)).toThrowError(
      /config inválida em switch/i,
    );
  });
});
