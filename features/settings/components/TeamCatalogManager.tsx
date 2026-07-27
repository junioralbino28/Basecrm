import React from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import {
  teamCatalogsService,
  type TeamCatalogItem,
  type TeamCatalogKind,
} from '@/lib/supabase/teamCatalogs';

type Props = {
  kind: TeamCatalogKind;
  titulo: string;
  descricao: string;
  /** Rótulo no singular, usado nos textos ("Nova especialidade"). */
  singular: string;
  placeholder: string;
  /**
   * O que acontece com quem já está marcado, dito em linguagem de leigo.
   * Muda por catálogo: cargo é texto na ficha da pessoa e sobrevive; especialidade
   * é ligação e some da ficha junto (ON DELETE CASCADE).
   */
  avisoExclusao?: string;
};

/**
 * Lista configurável da equipe (cargos, especialidades).
 *
 * Um componente para os dois catálogos: eles têm a mesma forma, então duplicar
 * tela seria espaguete. Existe porque cargo e especialidade eram TEXTO LIVRE e
 * "Ortodontia" × "ortodontia" quebravam agrupamento e relatório em silêncio
 * (apontado pelo Junior, 2026-07-24).
 */
export const TeamCatalogManager: React.FC<Props> = ({
  kind, titulo, descricao, singular, placeholder, avisoExclusao,
}) => {
  const [itens, setItens] = React.useState<TeamCatalogItem[]>([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);
  const [novo, setNovo] = React.useState('');
  const [editandoId, setEditandoId] = React.useState<string | null>(null);
  const [editNome, setEditNome] = React.useState('');
  const [ocupado, setOcupado] = React.useState(false);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    const { data, error } = await teamCatalogsService.list(kind);
    if (error) setErro(error.message);
    else { setItens(data); setErro(null); }
    setCarregando(false);
  }, [kind]);

  React.useEffect(() => { void carregar(); }, [carregar]);

  const criar = async () => {
    const nome = novo.trim();
    if (nome.length < 2) return;
    setOcupado(true);
    const { error } = await teamCatalogsService.create(kind, nome);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setNovo('');
    setErro(null);
    await carregar();
  };

  const salvarNome = async () => {
    if (!editandoId) return;
    const nome = editNome.trim();
    if (nome.length < 2) { setErro('Nome muito curto.'); return; }
    setOcupado(true);
    const { error } = await teamCatalogsService.rename(kind, editandoId, nome);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setEditandoId(null);
    setErro(null);
    await carregar();
  };

  const remover = async (item: TeamCatalogItem) => {
    const ok = window.confirm(
      `Excluir "${item.name}"? ${avisoExclusao
        || 'Quem já está cadastrado com isso mantém o registro, mas o nome deixa de aparecer na lista.'}`,
    );
    if (!ok) return;
    setOcupado(true);
    const { error } = await teamCatalogsService.remove(kind, item.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    await carregar();
  };

  return (
    <div className="mb-12">
      <div className="bg-card border border-line rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-ink mb-1">{titulo}</h3>
        <p className="text-sm text-muted">{descricao}</p>

        {erro && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {erro}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor={`novo-${kind}`} className="block text-xs font-semibold text-muted mb-1">
              {singular}
            </label>
            <input
              id={`novo-${kind}`}
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <button
            type="button"
            onClick={criar}
            disabled={ocupado || novo.trim().length < 2}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Adicionar
          </button>
        </div>

        <div className="mt-6 border-t border-line pt-4">
          {carregando ? (
            <div className="text-sm text-muted py-6">Carregando…</div>
          ) : itens.length === 0 ? (
            <div className="text-sm text-muted py-6">
              Nada cadastrado ainda. Adicione o primeiro acima.
            </div>
          ) : (
            <div className="space-y-2">
              {itens.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/60 px-4 py-2.5"
                >
                  {editandoId === item.id ? (
                    <>
                      <input
                        aria-label={`Novo nome de ${item.name}`}
                        value={editNome}
                        onChange={(e) => setEditNome(e.target.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={salvarNome}
                          disabled={ocupado}
                          className="px-2 py-1.5 rounded-lg border border-line bg-card hover:bg-surface disabled:opacity-50"
                          aria-label="Salvar nome"
                        >
                          <Save className="h-4 w-4 text-brand-500" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditandoId(null)}
                          className="px-2 py-1.5 rounded-lg border border-line bg-card hover:bg-surface"
                          aria-label="Cancelar"
                        >
                          <X className="h-4 w-4 text-muted" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-ink truncate">{item.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => { setEditandoId(item.id); setEditNome(item.name); }}
                          className="px-2 py-1.5 rounded-lg border border-line bg-card hover:bg-surface"
                          aria-label={`Renomear ${item.name}`}
                        >
                          <Pencil className="h-4 w-4 text-muted" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remover(item)}
                          disabled={ocupado}
                          className="px-2 py-1.5 rounded-lg border border-line bg-card hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                          aria-label={`Excluir ${item.name}`}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
