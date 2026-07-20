'use client';

import React from 'react';
import { Tag } from 'lucide-react';
import type { AutomationWorkspaceItem } from '@/lib/automations/workspace';

type AutomationFlowToolbarProps = {
  automations: AutomationWorkspaceItem[];
  selected: AutomationWorkspaceItem;
  onSelect: (automationId: string) => void;
  actions: React.ReactNode;
};

function statusLabel(status: AutomationWorkspaceItem['lifecycleStatus']) {
  if (status === 'published') return 'Publicada';
  if (status === 'paused') return 'Pausada';
  return 'Rascunho';
}

function statusClass(status: AutomationWorkspaceItem['lifecycleStatus']) {
  if (status === 'published') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (status === 'paused') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
}

export function AutomationFlowToolbar({
  automations,
  selected,
  onSelect,
  actions,
}: AutomationFlowToolbarProps) {
  const legacyTag = typeof selected.triggerConfig.tag === 'string'
    ? selected.triggerConfig.tag.trim()
    : '';

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0B100F] px-4 py-3 text-slate-100 shadow-lg backdrop-blur lg:flex-row lg:items-center">
      <label className="relative min-w-0">
        <span className="sr-only">Automação</span>
        <select
          aria-label="Automação"
          className="max-w-full appearance-none rounded-[10px] border border-white/10 bg-[#141D1A] py-2 pl-3 pr-9 text-sm font-semibold text-slate-100 outline-none transition hover:border-teal-500 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          value={selected.id}
          onChange={(event) => onSelect(event.target.value)}
        >
          {automations.map((automation) => (
            <option key={automation.id} value={automation.id}>
              {automation.name}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500"
        >
          ▾
        </span>
      </label>

      <span className={`w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(selected.lifecycleStatus)}`}>
        {statusLabel(selected.lifecycleStatus)}
      </span>

      <div
        data-testid="service-tag-trigger-boundary"
        data-trigger-contract="service-tag-entity-v3"
        className="flex min-w-0 items-center gap-2 text-xs text-slate-500"
      >
        <Tag className="h-3.5 w-3.5 shrink-0" />
        {legacyTag ? (
          <span>
            começa com a etiqueta{' '}
            <strong className="font-semibold text-slate-300">{legacyTag}</strong>
          </span>
        ) : (
          <span title="O seletor controlado por entidade será conectado na C2.">
            gatilho de serviço ainda não selecionado
          </span>
        )}
      </div>

      {actions ? (
        <div className="flex flex-wrap gap-2 lg:ml-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
