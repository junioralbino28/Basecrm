'use client';

import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AutomationBuilderStep } from '@/lib/automations/builder';
import {
  automationSwitchCases,
  MAX_AUTOMATION_SWITCH_CASES,
  SWITCH_CASE_LIMIT_MESSAGE,
  type AutomationSwitchCase,
} from './automationSwitchDraft';

const FIELD_CLASS =
  'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-60';

const PHONE_OPERATORS: Array<[AutomationSwitchCase['operator'], string]> = [
  ['equals', 'é igual a'],
  ['not_equals', 'não é igual a'],
  ['contains', 'contém'],
  ['not_contains', 'não contém'],
  ['exists', 'existe'],
];
const TAG_OPERATORS: Array<[AutomationSwitchCase['operator'], string]> = [
  ['contains', 'contém'],
  ['not_contains', 'não contém'],
];
const ENTITY_OPERATORS = PHONE_OPERATORS.filter(([operator]) => (
  operator === 'equals' || operator === 'not_equals' || operator === 'exists'
));

export function AutomationSwitchEditor({
  step,
  canEdit,
  onConfig,
  onAddCase,
  onRemoveCase,
  onMoveCase,
}: {
  step: AutomationBuilderStep;
  canEdit: boolean;
  onConfig: (config: Record<string, unknown>) => void;
  onAddCase: () => string | null;
  onRemoveCase: (caseId: string) => string | null;
  onMoveCase: (caseId: string, direction: 'up' | 'down') => string | null;
}) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const cases = automationSwitchCases(step);
  const field = String(step.config.field ?? 'contact.phone');

  React.useEffect(() => setNotice(null), [step.stepKey]);

  const updateCase = (caseId: string, patch: Partial<AutomationSwitchCase>) => {
    onConfig({
      ...step.config,
      cases: cases.map((item) => (
        item.case_id === caseId ? { ...item, ...patch } : item
      )),
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-xs text-teal-100">
        Avaliamos de cima para baixo: o primeiro caminho compatível vence.
      </div>

      <label className="block space-y-1.5 text-xs text-slate-300">
        Comparar
        <select
          aria-label="Campo de comparação"
          className={FIELD_CLASS}
          value={field}
          onChange={(event) => {
            const nextField = event.target.value;
            const allowed = nextField === 'contact.phone'
              ? PHONE_OPERATORS.map(([operator]) => operator)
              : ENTITY_OPERATORS.map(([operator]) => operator);
            onConfig({
              ...step.config,
              field: nextField,
              cases: cases.map((item) => {
                const operator = allowed.includes(item.operator) ? item.operator : 'equals';
                return {
                  ...item,
                  operator,
                  value: operator === 'exists' ? null : (item.value ?? ''),
                };
              }),
            });
          }}
          disabled={!canEdit}
        >
          {field === 'deal.tags' ? (
            <option value="deal.tags" disabled>Etiqueta do negócio (conectada na C2)</option>
          ) : null}
          <option value="contact.phone">Telefone do contato</option>
          <option value="deal.stage_id">Etapa do negócio</option>
          <option value="deal.board_id">Funil do negócio</option>
        </select>
      </label>

      {field === 'deal.tags' ? (
        <div
          data-testid="service-tag-switch-boundary"
          data-switch-contract="service-tag-entity-v3"
          className="rounded-lg border border-dashed border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100"
        >
          Etiqueta já vinculada. O seletor por entidade (UUID) será conectado aqui na C2.
        </div>
      ) : null}

      <div className="space-y-2">
        {cases.map((item, index) => {
          const operators = field === 'contact.phone'
            ? PHONE_OPERATORS
            : field === 'deal.tags'
              ? TAG_OPERATORS
              : ENTITY_OPERATORS;
          return (
            <div
              key={item.case_id}
              className="rounded-xl border border-white/10 bg-black/20 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-teal-300">
                  {index + 1}. caminho
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Mover caminho ${index + 1} para cima`}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                    disabled={!canEdit || index === 0}
                    onClick={() => setNotice(onMoveCase(item.case_id, 'up'))}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Mover caminho ${index + 1} para baixo`}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                    disabled={!canEdit || index === cases.length - 1}
                    onClick={() => setNotice(onMoveCase(item.case_id, 'down'))}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover caminho ${index + 1}`}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-30"
                    disabled={!canEdit || cases.length <= 1}
                    onClick={() => setNotice(onRemoveCase(item.case_id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[1fr_0.8fr_1fr]">
                <label className="space-y-1 text-[11px] text-slate-400">
                  Nome na linha
                  <input
                    aria-label={`Nome do caminho ${index + 1}`}
                    className={FIELD_CLASS}
                    maxLength={80}
                    value={item.label}
                    onChange={(event) => updateCase(item.case_id, { label: event.target.value })}
                    disabled={!canEdit}
                  />
                </label>
                <label className="space-y-1 text-[11px] text-slate-400">
                  Regra
                  <select
                    aria-label={`Regra do caminho ${index + 1}`}
                    className={FIELD_CLASS}
                    value={item.operator}
                    onChange={(event) => {
                      const operator = event.target.value as AutomationSwitchCase['operator'];
                      updateCase(item.case_id, {
                        operator,
                        value: operator === 'exists' ? null : (item.value ?? ''),
                      });
                    }}
                    disabled={!canEdit}
                  >
                    {operators.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                {field !== 'deal.tags' && item.operator !== 'exists' ? (
                  <label className="space-y-1 text-[11px] text-slate-400">
                    Valor
                    <input
                      aria-label={`Valor do caminho ${index + 1}`}
                      className={FIELD_CLASS}
                      maxLength={240}
                      value={String(item.value ?? '')}
                      onChange={(event) => updateCase(item.case_id, { value: event.target.value })}
                      disabled={!canEdit}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-dashed border-white/15 px-3 py-2.5">
        <div className="text-xs font-semibold text-slate-300">
          Caminho final · para quem não se encaixa
        </div>
        <label className="mt-2 block space-y-1 text-[11px] text-slate-400">
          Nome na linha
          <input
            aria-label="Nome do caminho final"
            className={FIELD_CLASS}
            maxLength={80}
            value={String(step.config.fallback_label ?? '')}
            onChange={(event) => onConfig({
              ...step.config,
              fallback_label: event.target.value,
            })}
            disabled={!canEdit}
          />
        </label>
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={!canEdit || cases.length >= MAX_AUTOMATION_SWITCH_CASES}
        onClick={() => setNotice(onAddCase())}
      >
        <Plus className="mr-2 h-4 w-4" />
        Adicionar caminho
      </Button>
      {cases.length >= MAX_AUTOMATION_SWITCH_CASES ? (
        <p className="text-xs text-amber-300">{SWITCH_CASE_LIMIT_MESSAGE}</p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-amber-300">{notice}</p>
      ) : null}
    </div>
  );
}
