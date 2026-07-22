'use client';

/**
 * Seletor da etiqueta de gatilho (C2C) — substitui a fronteira
 * `service-tag-entity-v3` deixada na C1B por seleção real de entidade.
 *
 * Contrato (§N1.1 + adjudicações):
 * - O gatilho grava `{ tag_id: <uuid> }` no rascunho; a publicação vira
 *   `schemaVersion: 3`. Nunca texto livre.
 * - Etiqueta de serviço PODE ser criada AQUI (o fluxo é dono do próprio
 *   gatilho) — mas só por quem tem `tags.manage`, via fluxo controlado com
 *   dedupe no banco (`get_or_create_tag`). No card do negócio, não se cria.
 * - Gatilho legado (texto, v2) aparece somente leitura; escolher uma entidade
 *   migra o rascunho para o contrato novo.
 */

import React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { dealTagsService } from '@/lib/supabase/dealTags';
import type { TagCategory, TagEntity } from '@/types';

type TriggerTagSelectorProps = {
  organizationId: string;
  triggerConfig: Record<string, unknown>;
  canEdit: boolean;
  /** `tags.manage` — habilita criar etiqueta nova dentro do gatilho. */
  canManage: boolean;
  onSelectTag: (tagId: string) => void;
};

export function TriggerTagSelector({
  organizationId,
  triggerConfig,
  canEdit,
  canManage,
  onSelectTag,
}: TriggerTagSelectorProps) {
  const [categories, setCategories] = React.useState<TagCategory[]>([]);
  const [tags, setTags] = React.useState<TagEntity[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeCategoryId, setActiveCategoryId] = React.useState<string | null>(null);
  const [newTagName, setNewTagName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const selectedTagId = typeof triggerConfig.tag_id === 'string' ? triggerConfig.tag_id : '';
  const legacyText = typeof triggerConfig.tag === 'string' ? triggerConfig.tag.trim() : '';

  const tagsById = React.useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const selectedTag = selectedTagId ? tagsById.get(selectedTagId) ?? null : null;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void dealTagsService.getCatalog(organizationId).then((catalog) => {
      if (cancelled) return;
      if (catalog.error) {
        setErrorText('Não foi possível carregar as etiquetas.');
      } else {
        setCategories(catalog.categories);
        setTags(catalog.tags);
        setErrorText(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

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

  const pickTag = (tagId: string) => {
    setMenuOpen(false);
    setNewTagName('');
    onSelectTag(tagId);
  };

  const createAndPick = async () => {
    if (!activeCategoryId || !newTagName.trim()) return;
    setCreating(true);
    setErrorText(null);
    const result = await dealTagsService.createTag(organizationId, activeCategoryId, newTagName);
    if (result.error || !result.data) {
      setErrorText(result.error?.message || 'Não foi possível criar a etiqueta.');
    } else {
      setTags((current) => {
        const exists = current.some((tag) => tag.id === result.data!.id);
        return exists ? current : [...current, result.data!];
      });
      pickTag(result.data.id);
    }
    setCreating(false);
  };

  const activeCategory = activeCategoryId
    ? categories.find((category) => category.id === activeCategoryId) ?? null
    : null;
  const categoryTags = activeCategoryId
    ? tags.filter((tag) => tag.categoryId === activeCategoryId)
    : [];

  if (loading) {
    return (
      <span className="flex items-center gap-1.5">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Carregando etiquetas…
      </span>
    );
  }

  return (
    <div className="relative min-w-0" ref={menuRef}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {selectedTag ? (
          <span className="truncate">
            começa com a etiqueta{' '}
            <strong className="font-semibold text-slate-300">{selectedTag.name}</strong>
          </span>
        ) : selectedTagId ? (
          <span className="text-amber-300/90">
            etiqueta do gatilho não encontrada (arquivada?)
          </span>
        ) : legacyText ? (
          <span className="truncate" title="Gatilho antigo por texto (v2). Escolha uma etiqueta para migrar ao contrato novo.">
            começa com a etiqueta{' '}
            <strong className="font-semibold text-slate-300">{legacyText}</strong>
            <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-300/80">legado</span>
          </span>
        ) : null}

        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setActiveCategoryId(null);
              setMenuOpen((open) => !open);
            }}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-teal-500 hover:text-teal-300"
          >
            {selectedTag || legacyText ? 'Trocar etiqueta' : 'gatilho de serviço ainda não selecionado — escolher'}
          </button>
        ) : !selectedTag && !legacyText ? (
          <span>gatilho de serviço ainda não selecionado</span>
        ) : null}
      </div>

      {menuOpen ? (
        <div
          role="menu"
          aria-label="Escolher etiqueta de gatilho"
          className="absolute left-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0B100F] shadow-2xl"
        >
          {categories.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400">
              {canManage
                ? 'Nenhuma categoria ainda. Crie primeiro em Configurações → Etiquetas.'
                : 'Nenhuma etiqueta configurada. Peça à administração para criar as categorias.'}
            </p>
          ) : activeCategory ? (
            <>
              <button
                type="button"
                onClick={() => setActiveCategoryId(null)}
                className="w-full px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-300"
              >
                ← {activeCategory.label}
              </button>
              {categoryTags.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-500">
                  Nenhuma etiqueta nesta categoria ainda.
                </p>
              ) : (
                categoryTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    role="menuitem"
                    onClick={() => pickTag(tag.id)}
                    className="w-full px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                  >
                    {tag.name}
                    {tag.id === selectedTagId ? (
                      <span className="ml-2 text-[10px] uppercase text-teal-400">atual</span>
                    ) : null}
                  </button>
                ))
              )}
              {canManage ? (
                <div className="border-t border-white/10 p-2">
                  <div className="flex gap-1.5">
                    <input
                      value={newTagName}
                      onChange={(event) => setNewTagName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void createAndPick();
                        }
                      }}
                      placeholder="Nova etiqueta nesta categoria…"
                      aria-label={`Nova etiqueta em ${activeCategory.label}`}
                      disabled={creating}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-teal-500"
                    />
                    <button
                      type="button"
                      onClick={() => void createAndPick()}
                      disabled={creating || !newTagName.trim()}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-500 disabled:opacity-50"
                    >
                      {creating ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                      Criar
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Nomes repetidos (acento/caixa) reaproveitam a etiqueta existente.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            categories.map((category) => (
              <button
                key={category.id}
                type="button"
                role="menuitem"
                onClick={() => setActiveCategoryId(category.id)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/5"
              >
                {category.label}
                <span className="text-xs text-slate-500">
                  {tags.filter((tag) => tag.categoryId === category.id).length}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {errorText ? (
        <p className="mt-1 text-[11px] text-rose-400" role="alert">{errorText}</p>
      ) : null}
    </div>
  );
}
