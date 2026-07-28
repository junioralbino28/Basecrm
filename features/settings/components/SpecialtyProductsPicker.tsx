import React from 'react';
import { useProducts } from '@/lib/query/hooks/useProductsQuery';
import { specialtyProductsService } from '@/lib/supabase/specialtyProducts';
import { formatBRL } from '@/lib/utils';
import { AcoesEmMassa } from './AcoesEmMassa';

/**
 * Quais procedimentos cabem nesta especialidade.
 *
 * Pedido do Junior (2026-07-27): marcar uma vez aqui e, ao dar a especialidade a
 * alguém, os procedimentos dela já aparecerem ligados na ficha — "igual fizemos
 * na hora de criar acesso a quem vai usar o CRM no menu equipe".
 *
 * Um procedimento pode caber em várias especialidades (consulta inicial serve a
 * todas), então isto NÃO é exclusivo.
 */
export const SpecialtyProductsPicker: React.FC<{ specialtyId: string }> = ({ specialtyId }) => {
  const { data: produtosData, isLoading: carregandoProdutos } = useProducts();
  const produtos = React.useMemo(() => produtosData ?? [], [produtosData]);

  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);
  const [busca, setBusca] = React.useState('');
  const [salvando, setSalvando] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivo = true;
    setCarregando(true);
    void specialtyProductsService.list().then(({ data, error }) => {
      if (!vivo) return;
      if (error) setErro(error.message);
      else {
        setMarcados(new Set(data.filter((l) => l.specialtyId === specialtyId).map((l) => l.productId)));
        setErro(null);
      }
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, [specialtyId]);

  const alternar = async (productId: string) => {
    const marcado = marcados.has(productId);
    // Otimista: a lista tem centenas de itens e esperar a ida e volta a cada
    // clique tornaria a marcação insuportável.
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.delete(productId); else proximo.add(productId);
      return proximo;
    });
    setSalvando(productId);
    const { error } = await specialtyProductsService.set(specialtyId, productId, !marcado);
    setSalvando(null);
    if (error) {
      setErro(error.message);
      setMarcados((atual) => {
        const proximo = new Set(atual);
        if (marcado) proximo.add(productId); else proximo.delete(productId);
        return proximo;
      });
    }
  };

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return [...produtos]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .filter((p) => !termo || (p.name || '').toLowerCase().includes(termo));
  }, [produtos, busca]);

  /**
   * Marca/desmarca os que estão À VISTA. Com busca ativa, agir sobre os 294 do
   * catálogo quando a pessoa filtrou 5 seria uma surpresa desagradável — por
   * isso o rótulo diz "visíveis" quando há filtro.
   */
  const marcarEmMassa = async (marcar: boolean) => {
    const alvos = visiveis.filter((p) => marcados.has(p.id) !== marcar);
    if (alvos.length === 0) return;
    setMarcados((atual) => {
      const proximo = new Set(atual);
      for (const p of alvos) { if (marcar) proximo.add(p.id); else proximo.delete(p.id); }
      return proximo;
    });
    for (const p of alvos) {
      const { error } = await specialtyProductsService.set(specialtyId, p.id, marcar);
      if (error) { setErro(error.message); break; }
    }
  };

  if (carregando || carregandoProdutos) {
    return <div className="py-4 text-sm text-muted">Carregando procedimentos…</div>;
  }

  if (produtos.length === 0) {
    return (
      <div className="py-4 text-sm text-muted">
        Nenhum procedimento cadastrado ainda — cadastre em Produtos/Serviços.
      </div>
    );
  }

  return (
    <div className="pt-3">
      <p className="text-xs text-muted mb-3">
        Marque os procedimentos que fazem parte desta especialidade. Quem tiver
        esta especialidade já abre a ficha com eles ligados — e ainda dá pra
        ligar ou desligar um a um lá.
      </p>

      {erro && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          {erro}
        </div>
      )}

      <input
        aria-label="Buscar procedimento"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar procedimento…"
        className="w-full max-w-sm mb-3 px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs text-muted">
          {marcados.size === 0
            ? 'Nenhum marcado ainda.'
            : `${marcados.size} de ${produtos.length} marcados.`}
        </span>
        <AcoesEmMassa
          onMarcarTodos={() => void marcarEmMassa(true)}
          onDesmarcarTodos={() => void marcarEmMassa(false)}
          desabilitado={visiveis.length === 0}
          escopo={busca.trim() ? `os ${visiveis.length} visíveis` : 'todos'}
        />
      </div>

      <div className="max-h-80 overflow-y-auto rounded-xl border border-line divide-y divide-line/60">
        {visiveis.map((p) => {
          const marcado = marcados.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              role="switch"
              aria-checked={marcado}
              onClick={() => void alternar(p.id)}
              disabled={salvando === p.id}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface/60 disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="block text-sm text-ink truncate">{p.name}</span>
                <span className="block text-[11px] text-muted tabular-nums">{formatBRL(p.price)}</span>
              </span>
              <span
                aria-hidden="true"
                className={`shrink-0 h-5 w-9 rounded-full transition-colors relative ${
                  marcado ? 'bg-brand-600' : 'bg-line'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                    marcado ? 'left-[1.125rem]' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
