'use client';

/**
 * "Adicionar tag" do negócio (C2C, §N1.1) — desenho do Junior:
 * botão → menu de CATEGORIAS → etiquetas da categoria → seleciona.
 *
 * Regras do contrato:
 * - A secretária NUNCA digita etiqueta que o sistema lê — só seleciona.
 * - No card NÃO se cria categoria/etiqueta (nem admin): criação vive na
 *   configuração e no gatilho do construtor (adjudicação do parecer, §3).
 * - Categoria `single`: escolher outra substitui a atual (o banco resolve).
 * - Principal: troca com um clique, nunca obrigatória (N1.2/D2) — só o
 *   principal dispara automação quando o lead esfria.
 */

import React from 'react';
import { Loader2, Plus, Star, Tag as TagIcon, X } from 'lucide-react';
import { dealTagsService } from '@/lib/supabase/dealTags';
import type { DealTagAssignment, TagCategory, TagEntity } from '@/types';

type DealTagSelectorProps = {
  organizationId: string;
  dealId: string;
  /** `tags.assign` — sem ela o bloco fica somente leitura. */
  canAssign: boolean;
  /** `tags.manage` — só muda o texto do vazio (aponta a configuração). */
  canManage: boolean;
};

export function DealTagSelector({ organizationId, dealId, canAssign, canManage }: DealTagSelectorProps) {
  const [categories, setCategories] = React.useState<TagCategory[]>([]);
  const [tags, setTags] = React.useState<TagEntity[]>([]);
  const [assignments, setAssignments] = React.useState<DealTagAssignment[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyTagId, setBusyTagId] = React.useState<string | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeCategoryId, setActiveCategoryId] = React.useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const tagsById = React.useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const categoriesById = React.useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const assignedTagIds = React.useMemo(
    () => new Set(assignments.map((assignment) => assignment.tagId)),
    [assignments],
  );

  const reload = React.useCallback(async () => {
    const [catalog, current] = await Promise.all([
      dealTagsService.getCatalog(organizationId),
      dealTagsService.getAssignments(organizationId, dealId),
    ]);
    if (catalog.error || current.error) {
      setErrorText('Não foi possível carregar as etiquetas. Recarregue a página.');
      return;
    }
    setCategories(catalog.categories);
    setTags(catalog.tags);
    setAssignments(current.data);
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

  React.useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const closeOnOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnOutside);
    };
  }, [menuOpen]);

  const runMutation = async (tagId: string, action: () => Promise<{ error: Error | null }>) => {
    setBusyTagId(tagId);
    setErrorText(null);
    const result = await action();
    if (result.error) {
      setErrorText(result.error.message || 'Não foi possível salvar a etiqueta.');
    } else {
      await reload();
    }
    setBusyTagId(null);
  };

  const assignTag = (tagId: string) => {
    setMenuOpen(false);
    void runMutation(tagId, () => dealTagsService.assign(organizationId, dealId, tagId));
  };

  const activeCategory = activeCategoryId ? categoriesById.get(activeCategoryId) ?? null : null;
  const selectableTags = activeCategoryId
    ? tags.filter((tag) => tag.categoryId === activeCategoryId && !assignedTagIds.has(tag.id))
    : [];

  return (
    <div data-testid="deal-tag-selector">
      <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
        <TagIcon size={14} /> Etiquetas
      </h3>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Carregando etiquetas…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {assignments.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Nenhuma etiqueta aplicada.</p>
            ) : (
              assignments.map((assignment) => {
                const tag = tagsById.get(assignment.tagId);
                const category = categoriesById.get(assignment.categoryId);
                const busy = busyTagId === assignment.tagId;
                return (
                  <span
                    key={assignment.id}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10"
                  >
                    {category ? (
                      <span className="text-slate-400">{category.label} ·</span>
                    ) : null}
                    {tag?.name ?? 'Etiqueta arquivada'}
                    {assignment.isPrimary ? (
                      <Star
                        size={11}
                        className="text-amber-500 fill-amber-500"
                        aria-label="Etiqueta principal — é ela que dispara a automação"
                      />
                    ) : canAssign ? (
                      <button
                        type="button"
                        onClick={() => void runMutation(
                          assignment.tagId,
                          () => dealTagsService.setPrimary(organizationId, dealId, assignment.tagId),
                        )}
                        disabled={busy}
                        className="text-slate-300 hover:text-amber-500 disabled:opacity-50"
                        aria-label={`Tornar ${tag?.name ?? 'etiqueta'} a principal`}
                        title="Tornar principal (é a que dispara a automação)"
                      >
                        <Star size={11} />
                      </button>
                    ) : null}
                    {canAssign ? (
                      <button
                        type="button"
                        onClick={() => void runMutation(
                          assignment.tagId,
                          () => dealTagsService.remove(organizationId, dealId, assignment.tagId),
                        )}
                        disabled={busy}
                        className="ml-0.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
                        aria-label={`Remover etiqueta ${tag?.name ?? ''}`}
                        title="Remover etiqueta"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                      </button>
                    ) : null}
                  </span>
                );
              })
            )}
          </div>

          {canAssign ? (
            <div className="relative mt-3" ref={menuRef}>
              <button
                type="button"
                onClick={() => {
                  setActiveCategoryId(null);
                  setMenuOpen((open) => !open);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <Plus size={14} aria-hidden="true" /> Adicionar tag
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  aria-label="Escolher etiqueta"
                  className="absolute z-20 mt-2 w-64 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
                >
                  {categories.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-slate-500">
                      {canManage
                        ? 'Nenhuma categoria de etiqueta ainda. Crie as categorias e etiquetas em Configurações → Etiquetas.'
                        : 'Nenhuma etiqueta configurada ainda. Peça à administração para criar as categorias em Configurações.'}
                    </p>
                  ) : activeCategory ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveCategoryId(null)}
                        className="w-full text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        ← {activeCategory.label}
                      </button>
                      {activeCategory.cardinality === 'single' ? (
                        <p className="px-3 pb-1 text-[10.5px] text-slate-400">
                          Escolher outra substitui a atual.
                        </p>
                      ) : null}
                      {selectableTags.length === 0 ? (
                        <p className="px-3 py-2.5 text-xs text-slate-500">
                          Todas as etiquetas desta categoria já estão aplicadas.
                        </p>
                      ) : (
                        selectableTags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            role="menuitem"
                            onClick={() => assignTag(tag.id)}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                          >
                            {tag.name}
                          </button>
                        ))
                      )}
                    </>
                  ) : (
                    categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        role="menuitem"
                        onClick={() => setActiveCategoryId(category.id)}
                        className="w-full flex items-center justify-between text-left px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                      >
                        {category.label}
                        <span className="text-slate-400 text-xs">
                          {tags.filter((tag) => tag.categoryId === category.id).length}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {errorText ? (
            <p className="mt-2 text-xs text-rose-500" role="alert">{errorText}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
