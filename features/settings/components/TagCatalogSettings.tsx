'use client';

/**
 * Configurações → Etiquetas (C2C, §N1.1) — onde categorias, etiquetas e
 * origens são CRIADAS. É o destino dos textos de vazio dos seletores.
 *
 * Regras:
 * - Só quem tem `tags.manage` / `lead_sources.manage` enxerga (gate no
 *   SettingsPage; a RLS recusa mutação de quem não tem).
 * - Cardinalidade é decidida NA CRIAÇÃO e não muda depois de usada (guard).
 * - Apagar não existe: arquiva. O banco bloqueia arquivamento com dependência
 *   publicada e devolve mensagem acionável — a tela só a exibe.
 */

import React from 'react';
import { Archive, ArchiveRestore, HelpCircle, Loader2, MapPin, Plus, Tag as TagIcon } from 'lucide-react';
import { dealTagsService } from '@/lib/supabase/dealTags';
import { leadSourcesService } from '@/lib/supabase/leadSources';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import type { LeadSource, TagCategory, TagEntity } from '@/types';

const FIELD =
  'min-w-0 flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:text-white';

export const TagCatalogSettings: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId ?? profile?.organization_id ?? null;

  const [loading, setLoading] = React.useState(true);
  const [categories, setCategories] = React.useState<TagCategory[]>([]);
  const [tags, setTags] = React.useState<TagEntity[]>([]);
  const [sources, setSources] = React.useState<LeadSource[]>([]);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const [newCategoryLabel, setNewCategoryLabel] = React.useState('');
  const [newCategoryCardinality, setNewCategoryCardinality] = React.useState<'single' | 'multiple'>('multiple');
  const [newTagByCategory, setNewTagByCategory] = React.useState<Record<string, string>>({});
  const [newSourceName, setNewSourceName] = React.useState('');

  const reload = React.useCallback(async () => {
    if (!organizationId) return;
    const [catalog, origins] = await Promise.all([
      dealTagsService.getCatalog(organizationId),
      leadSourcesService.getAll(organizationId),
    ]);
    if (catalog.error || origins.error) {
      setErrorText('Não foi possível carregar os catálogos. Recarregue a página.');
      return;
    }
    setCategories(catalog.categories);
    setTags(catalog.tags);
    setSources(origins.data);
    setErrorText(null);
  }, [organizationId]);

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

  const run = async (id: string, action: () => Promise<{ error: Error | null }>) => {
    setBusyId(id);
    setErrorText(null);
    const result = await action();
    if (result.error) {
      // Mensagens do banco já são acionáveis (ex.: dependência publicada).
      setErrorText(result.error.message || 'Não foi possível salvar.');
    } else {
      await reload();
    }
    setBusyId(null);
  };

  const createCategory = async () => {
    if (!organizationId || !newCategoryLabel.trim()) return;
    await run('new-category', async () => {
      const result = await dealTagsService.createCategory(
        organizationId,
        newCategoryLabel,
        newCategoryCardinality,
      );
      if (!result.error) {
        setNewCategoryLabel('');
        setNewCategoryCardinality('multiple');
      }
      return { error: result.error };
    });
  };

  const createTag = async (categoryId: string) => {
    const name = (newTagByCategory[categoryId] || '').trim();
    if (!organizationId || !name) return;
    await run(`new-tag-${categoryId}`, async () => {
      const result = await dealTagsService.createTag(organizationId, categoryId, name);
      if (!result.error) {
        setNewTagByCategory((current) => ({ ...current, [categoryId]: '' }));
      }
      return { error: result.error };
    });
  };

  const createSource = async () => {
    if (!newSourceName.trim()) return;
    await run('new-source', async () => {
      const result = await leadSourcesService.create({
        name: newSourceName,
        organizationId,
      });
      if (!result.error) setNewSourceName('');
      return { error: result.error };
    });
  };

  if (!organizationId) {
    return <p className="text-sm text-slate-500">Organização não selecionada.</p>;
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando catálogos…
      </p>
    );
  }

  return (
    <div className="pb-10 space-y-10">
      {errorText ? (
        <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200" role="alert">
          {errorText}
        </p>
      ) : null}

      {/* ============================== ETIQUETAS ============================== */}
      <section aria-label="Categorias de etiquetas">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <TagIcon size={16} /> Etiquetas
          <span
            className="cursor-help text-slate-400 dark:text-slate-500"
            title="O usuário seleciona destas listas, nunca digita. A etiqueta principal do negócio é a que dispara a automação quando o lead esfria."
            aria-label="O usuário seleciona destas listas, nunca digita. A etiqueta principal do negócio é a que dispara a automação quando o lead esfria."
            role="img"
          >
            <HelpCircle size={14} />
          </span>
        </h2>

        <div className="mb-5 flex flex-col gap-2 sm:flex-row">
          <input
            value={newCategoryLabel}
            onChange={(event) => setNewCategoryLabel(event.target.value)}
            placeholder="Nova categoria (ex.: Procedimentos)"
            aria-label="Nova categoria"
            className={FIELD}
          />
          <select
            value={newCategoryCardinality}
            onChange={(event) => setNewCategoryCardinality(event.target.value as 'single' | 'multiple')}
            aria-label="Cardinalidade da nova categoria"
            className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/10 dark:bg-black/20 dark:text-white"
          >
            <option value="multiple">Aceita várias</option>
            <option value="single">Só uma por negócio</option>
          </select>
          <button
            type="button"
            onClick={() => void createCategory()}
            disabled={!newCategoryLabel.trim() || busyId === 'new-category'}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyId === 'new-category' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            Criar categoria
          </button>
        </div>
        <p className="mb-4 -mt-3 text-[11px] text-slate-400">
          A cardinalidade não muda depois que a categoria entrar em uso.
        </p>

        {categories.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            Nenhuma categoria ainda. Comece por &quot;Procedimentos&quot; (o que o paciente quer).
          </p>
        ) : (
          <ul className="space-y-4">
            {categories.map((category) => {
              const categoryTags = tags.filter((tag) => tag.categoryId === category.id);
              const draft = newTagByCategory[category.id] || '';
              return (
                <li
                  key={category.id}
                  className="rounded-xl border border-slate-200 p-4 dark:border-white/10"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {category.label}
                    </span>
                    <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:border-white/10">
                      {category.cardinality === 'single' ? 'só uma por negócio' : 'aceita várias'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void run(
                        `cat-${category.id}`,
                        () => dealTagsService.setCategoryArchived(organizationId, category.id, true),
                      )}
                      disabled={busyId === `cat-${category.id}`}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-amber-600 disabled:opacity-50"
                      title="Arquivar categoria (sai dos seletores; histórico permanece)"
                    >
                      <Archive size={13} aria-hidden="true" /> Arquivar
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {categoryTags.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">Nenhuma etiqueta nesta categoria.</p>
                    ) : (
                      categoryTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                        >
                          {tag.name}
                          <button
                            type="button"
                            onClick={() => void run(
                              `tag-${tag.id}`,
                              () => dealTagsService.setTagArchived(organizationId, tag.id, true),
                            )}
                            disabled={busyId === `tag-${tag.id}`}
                            className="text-slate-400 transition-colors hover:text-amber-600 disabled:opacity-50"
                            aria-label={`Arquivar etiqueta ${tag.name}`}
                            title="Arquivar etiqueta"
                          >
                            {busyId === `tag-${tag.id}`
                              ? <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                              : <Archive size={11} aria-hidden="true" />}
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={draft}
                      onChange={(event) => setNewTagByCategory((current) => ({
                        ...current,
                        [category.id]: event.target.value,
                      }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void createTag(category.id);
                        }
                      }}
                      placeholder={`Nova etiqueta em ${category.label}…`}
                      aria-label={`Nova etiqueta em ${category.label}`}
                      className={FIELD}
                    />
                    <button
                      type="button"
                      onClick={() => void createTag(category.id)}
                      disabled={!draft.trim() || busyId === `new-tag-${category.id}`}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-500 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300"
                    >
                      {busyId === `new-tag-${category.id}`
                        ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                        : <Plus size={13} aria-hidden="true" />}
                      Criar
                    </button>
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    Nomes repetidos (acento/caixa) reaproveitam a etiqueta existente — nunca duplicam.
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* =============================== ORIGENS =============================== */}
      <section aria-label="Origens de lead">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <MapPin size={16} /> Origens de lead
          <span
            className="cursor-help text-slate-400 dark:text-slate-500"
            title="De onde o lead veio (Anúncio Instagram, Indicação…). Alimenta o painel comercial e é um campo separado das etiquetas, de propósito."
            aria-label="De onde o lead veio (Anúncio Instagram, Indicação…). Alimenta o painel comercial e é um campo separado das etiquetas, de propósito."
            role="img"
          >
            <HelpCircle size={14} />
          </span>
        </h2>

        <div className="mb-5 flex gap-2">
          <input
            value={newSourceName}
            onChange={(event) => setNewSourceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void createSource();
              }
            }}
            placeholder="Nova origem (ex.: Anúncio Instagram)"
            aria-label="Nova origem"
            className={FIELD}
          />
          <button
            type="button"
            onClick={() => void createSource()}
            disabled={!newSourceName.trim() || busyId === 'new-source'}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyId === 'new-source' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            Criar origem
          </button>
        </div>

        {sources.length === 0 ? (
          <p className="text-sm text-slate-500 italic">Nenhuma origem cadastrada.</p>
        ) : (
          <ul className="space-y-1.5">
            {sources.map((source) => {
              const archived = !source.active || Boolean(source.archivedAt);
              return (
                <li
                  key={source.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-white/10"
                >
                  <span className={archived ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'}>
                    {source.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => void run(
                      `source-${source.id}`,
                      () => leadSourcesService.update(source.id, { active: archived }),
                    )}
                    disabled={busyId === `source-${source.id}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-amber-600 disabled:opacity-50"
                    title={archived ? 'Restaurar origem' : 'Arquivar origem (sai dos seletores; histórico permanece)'}
                  >
                    {busyId === `source-${source.id}`
                      ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                      : archived
                        ? <ArchiveRestore size={13} aria-hidden="true" />
                        : <Archive size={13} aria-hidden="true" />}
                    {archived ? 'Restaurar' : 'Arquivar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
