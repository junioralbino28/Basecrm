'use client';

/**
 * Origem do lead no negócio (C2C, §N1.1) — o SEGUNDO campo da mesma tela.
 *
 * Origem NÃO é etiqueta: é entidade separada (`lead_sources`), alimenta o
 * painel comercial e, depois, a conversão pro pixel. Por isso este campo vive
 * ao lado do seletor de etiquetas, com a própria lista.
 *
 * Regras:
 * - Seleção pura de origens já cadastradas (quem administra o catálogo é a
 *   configuração — `lead_sources.manage`).
 * - Registrar grava um TOQUE no histórico (append-only) e a RPC atualiza
 *   primeira/última origem na mesma transação. Nunca sobrescrevemos história.
 */

import React from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { leadSourcesService } from '@/lib/supabase/leadSources';
import type { LeadSource } from '@/types';

type DealOriginSelectorProps = {
  organizationId: string;
  dealId: string;
  /** `lead_sources.assign` — sem ela o bloco fica somente leitura. */
  canAssign: boolean;
};

export function DealOriginSelector({ organizationId, dealId, canAssign }: DealOriginSelectorProps) {
  const [sources, setSources] = React.useState<LeadSource[]>([]);
  const [firstSourceId, setFirstSourceId] = React.useState<string | null>(null);
  const [lastSourceId, setLastSourceId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState('');
  const [errorText, setErrorText] = React.useState<string | null>(null);

  const sourcesById = React.useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );

  const reload = React.useCallback(async () => {
    const [catalog, pointers] = await Promise.all([
      leadSourcesService.getActive(organizationId),
      leadSourcesService.getDealOriginPointers(organizationId, dealId),
    ]);
    if (catalog.error || pointers.error) {
      setErrorText('Não foi possível carregar as origens. Recarregue a página.');
      return;
    }
    setSources(catalog.data);
    setFirstSourceId(pointers.firstSourceId);
    setLastSourceId(pointers.lastSourceId);
    setErrorText(null);
  }, [organizationId, dealId]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void reload().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const registerTouch = async () => {
    if (!selectedId) return;
    setBusy(true);
    setErrorText(null);
    const result = await leadSourcesService.recordAttribution({
      organizationId,
      dealId,
      sourceId: selectedId,
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
    if (result.error) {
      setErrorText(result.error.message || 'Não foi possível registrar a origem.');
    } else {
      setSelectedId('');
      await reload();
    }
    setBusy(false);
  };

  const firstName = firstSourceId ? sourcesById.get(firstSourceId)?.name : null;
  const lastName = lastSourceId ? sourcesById.get(lastSourceId)?.name : null;

  return (
    <div data-testid="deal-origin-selector">
      <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
        <MapPin size={14} /> Origem do lead
      </h3>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Carregando origens…
        </p>
      ) : (
        <>
          {firstSourceId || lastSourceId ? (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {firstSourceId ? (
                <span className="inline-flex items-center gap-1 font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                  <span className="text-slate-400">Primeira ·</span>
                  {firstName ?? 'Origem arquivada'}
                </span>
              ) : null}
              {lastSourceId && lastSourceId !== firstSourceId ? (
                <span className="inline-flex items-center gap-1 font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                  <span className="text-slate-400">Última ·</span>
                  {lastName ?? 'Origem arquivada'}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">Origem ainda não registrada.</p>
          )}

          {canAssign ? (
            sources.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Nenhuma origem cadastrada ainda. As origens são criadas em Configurações.
              </p>
            ) : (
              <div className="mt-3 flex gap-2">
                <select
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                  className="min-w-0 flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:text-white"
                  aria-label="Registrar origem do lead"
                  disabled={busy}
                >
                  <option value="">Registrar origem…</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void registerTouch()}
                  disabled={!selectedId || busy}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 text-xs font-semibold transition-colors"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                  Registrar
                </button>
              </div>
            )
          ) : null}

          {errorText ? (
            <p className="mt-2 text-xs text-rose-500" role="alert">{errorText}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
