import React, { useMemo, useState } from 'react';
import { Percent, Save, Trash2, X } from 'lucide-react';
import type { CommissionAmountType, CommissionRule } from '@/types';
import { formatBRL } from '@/lib/utils';
import {
  useCommissionRules,
  useCreateCommissionRule,
  useDeleteCommissionRule,
} from '@/lib/query/hooks/useCommissionRulesQuery';
import { useProfessionals } from '@/lib/query/hooks/useProfessionalsQuery';
import { useProducts } from '@/lib/query/hooks/useProductsQuery';
import { useToast } from '@/context/ToastContext';
import {
  specialtyProductsService,
  professionalProductsService,
  type SpecialtyProductLink,
} from '@/lib/supabase/specialtyProducts';

/**
 * Comissão por funcionário × procedimento (config financeira). Só
 * clinic_admin/agency_admin enxerga (gate canManageSettings); a RLS
 * can_configure bloqueia SELECT e mutação de clinic_staff.
 *
 * FORMATO (redesenho 2026-07-24): **mestre-detalhe**. Escolhe-se a pessoa e
 * aparece a TABELA de procedimentos dela — procedimento, valor e comissão numa
 * linha só. Antes era lista plana em que cada regra repetia o nome do
 * profissional (89 cartões "Ana Clara Ofrante"), ilegível.
 *
 * Referência: o próprio Clinicorp (PMS que a clínica usa) organiza
 * `tabela de preços → especialidade → procedimento`, nunca lista plana —
 * verificado ao vivo em `GET /procedures/list` (3 tabelas: 65/294/4 itens,
 * agrupados em Cirurgia, Prótese, Ortodontia, Endodontia…).
 *
 * MODO EMBUTIDO (2026-07-27): com `professionalId`, a tela some o seletor de
 * pessoa e o cartão externo, e vira um bloco dentro da ficha do funcionário.
 * É o pedido do Junior: *"pra cadastrar certo profissional, especialidade,
 * serviço e comissão preciso ir em 3 menus"* — a comissão passa a morar onde a
 * pessoa mora. Mesmo componente nos dois lugares, de propósito: duplicar tela
 * seria espaguete e as duas versões divergiriam na primeira correção.
 */
export const CommissionsManager: React.FC<{
  /** Fixa a pessoa e esconde o seletor — usado dentro da ficha do funcionário. */
  professionalId?: string;
}> = ({ professionalId }) => {
  const { data, isLoading, error } = useCommissionRules();
  const { data: professionalsData, isLoading: professionalsLoading } = useProfessionals();
  // A comissão é POR PROCEDIMENTO (Junior, 24/07) — a lista vem do catálogo em
  // Configurações → Produtos/Serviços, nunca digitada à mão (erro de grafia
  // faria a regra nunca casar com o atendimento).
  const { data: productsData } = useProducts();
  const createMutation = useCreateCommissionRule();
  const deleteMutation = useDeleteCommissionRule();
  const { showToast } = useToast();

  const rules = useMemo(() => data ?? [], [data]);
  const professionals = useMemo(() => professionalsData ?? [], [professionalsData]);
  const products = useMemo(() => productsData ?? [], [productsData]);

  const [selecionadoNaTela, setSelecionadoNaTela] = useState('');
  const embutido = Boolean(professionalId);
  const selectedId = professionalId || selecionadoNaTela;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // O que a pessoa FAZ é derivado das especialidades dela + exceções gravadas
  // (Junior, 27/07). A lista inteira continua aparecendo; o que vem da
  // especialidade já abre ligado.
  const [vinculos, setVinculos] = useState<SpecialtyProductLink[]>([]);
  const [excecoes, setExcecoes] = useState<Record<string, boolean>>({});
  const [editType, setEditType] = useState<CommissionAmountType>('fixed');
  const [editValue, setEditValue] = useState('0');

  const selected = professionals.find((p) => p.id === selectedId) || null;

  /** Regra vigente = a de `validFrom` mais recente para aquele escopo. */
  const maisRecente = (lista: CommissionRule[]): CommissionRule | null =>
    lista.length
      ? [...lista].sort((a, b) => (b.validFrom || '').localeCompare(a.validFrom || ''))[0]
      : null;

  const regraGeral = useMemo(
    () => (selectedId
      ? maisRecente(rules.filter(
          (r) => r.professionalId === selectedId && !r.procedimento,
        ))
      : null),
    [rules, selectedId],
  );

  /** Uma linha por procedimento do catálogo + a comissão vigente dele. */
  const linhas = useMemo(() => {
    if (!selectedId) return [];
    return [...products]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((prod) => ({
        prod,
        regra: maisRecente(rules.filter(
          (r) => r.professionalId === selectedId && r.procedimento === prod.name,
        )),
      }));
  }, [products, rules, selectedId]);

  const contagemPorPessoa = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rules) {
      if (!r.professionalId) continue;
      map.set(r.professionalId, (map.get(r.professionalId) ?? 0) + 1);
    }
    return map;
  }, [rules]);

  React.useEffect(() => {
    void specialtyProductsService.list().then(({ data }) => setVinculos(data));
  }, []);

  React.useEffect(() => {
    if (!selectedId) { setExcecoes({}); return; }
    let vivo = true;
    void professionalProductsService.listOverrides(selectedId).then(({ data }) => {
      if (!vivo) return;
      setExcecoes(Object.fromEntries(data.map((o) => [o.productId, o.enabled])));
    });
    return () => { vivo = false; };
  }, [selectedId]);

  const especialidadesDaPessoa = useMemo(
    () => new Set(selected?.specialtyIds ?? []),
    [selected],
  );

  const vemDaEspecialidade = React.useCallback(
    (productId: string) => vinculos.some(
      (l) => l.productId === productId && especialidadesDaPessoa.has(l.specialtyId),
    ),
    [vinculos, especialidadesDaPessoa],
  );

  const faz = React.useCallback(
    (productId: string) => excecoes[productId] ?? vemDaEspecialidade(productId),
    [excecoes, vemDaEspecialidade],
  );

  const alternarFaz = async (productId: string) => {
    const proximo = !faz(productId);
    const padrao = vemDaEspecialidade(productId);
    setExcecoes((atual) => {
      const copia = { ...atual };
      // Voltou a coincidir com a especialidade → a exceção deixa de existir.
      if (proximo === padrao) delete copia[productId];
      else copia[productId] = proximo;
      return copia;
    });
    const { error } = await professionalProductsService.set(
      selectedId, productId, proximo, padrao,
    );
    if (error) showToast(`Não deu pra salvar: ${error.message}`, 'error');
  };

  const startEdit = (key: string, regra: CommissionRule | null) => {
    setEditingKey(key);
    setEditType(regra?.amountType ?? 'fixed');
    setEditValue(String(regra?.amount ?? 0));
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('0');
  };

  const salvar = async (procedimento: string | null) => {
    const valor = Number(editValue.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      showToast('Valor inválido.', 'error');
      return;
    }
    if (editType === 'percent' && valor > 100) {
      showToast('Percentual não pode passar de 100.', 'error');
      return;
    }
    try {
      // ⚠️ NUNCA edita a regra anterior — CRIA outra valendo de HOJE. É isso que
      // faz o mês já pago continuar valendo o que valia (decisão do Junior).
      await createMutation.mutateAsync({
        professionalId: selectedId,
        procedimento: procedimento || undefined,
        amountType: editType,
        amount: valor,
      });
      showToast('Vale de hoje em diante. O que já passou não muda.', 'success');
      cancelEdit();
    } catch (e) {
      showToast(`Erro ao salvar comissão: ${(e as Error).message}`, 'error');
    }
  };

  const remover = async (r: CommissionRule) => {
    const ok = window.confirm(
      'Apagar esta comissão? Use só para corrigir um valor lançado errado — '
      + 'para mudar o valor daqui pra frente, basta salvar o novo.',
    );
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(r.id);
    } catch (e) {
      showToast(`Erro ao apagar: ${(e as Error).message}`, 'error');
    }
  };

  const busy = isLoading || professionalsLoading
    || createMutation.isPending || deleteMutation.isPending;
  const loadError = error ? (error as Error).message : null;

  const mostraValor = (r: CommissionRule) =>
    r.amountType === 'fixed' ? formatBRL(r.amount) : `${r.amount}%`;

  // Sem componente de moldura declarado aqui dentro: componente definido no
  // corpo de outro remonta a árvore a cada render (e o lint barra).
  const conteudo = (
    <>
        <div className="min-w-0">
          <h3 className={`font-semibold text-ink mb-1 flex items-center gap-2 ${embutido ? 'text-sm' : 'text-lg'}`}>
            <Percent className={embutido ? 'h-4 w-4' : 'h-5 w-5'} />
            {embutido ? 'Quanto essa pessoa ganha em cada procedimento' : 'Comissões'}
          </h3>
          <p className="text-xs text-muted">
            {embutido
              ? <>Defina em valor ou porcentagem. O novo valor vale <strong>de hoje em diante</strong>; o que já passou continua como foi pago.</>
              : <>Escolha a pessoa e defina quanto ela ganha em cada procedimento — em valor ou em porcentagem. Ao salvar, o novo valor vale <strong>de hoje em diante</strong>; o que já passou continua como foi pago.</>}
          </p>
        </div>

        {loadError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {loadError}
          </div>
        )}

        {/* Mestre: quem — só na tela cheia; embutido a pessoa já é o dono da ficha */}
        {!embutido && (
        <div className="mt-5 max-w-md">
          <label htmlFor="comissao-pessoa" className="block text-xs font-semibold text-muted mb-1">
            Pessoa
          </label>
          <select
            id="comissao-pessoa"
            value={selectedId}
            onChange={(e) => { setSelecionadoNaTela(e.target.value); cancelEdit(); }}
            className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            <option value="">Selecione uma pessoa…</option>
            {professionals.map((p) => {
              const n = contagemPorPessoa.get(p.id) ?? 0;
              return (
                <option key={p.id} value={p.id}>
                  {p.name}{p.role ? ` — ${p.role}` : ''}
                  {n > 0 ? ` (${n} comissões)` : ' (sem comissão)'}
                </option>
              );
            })}
          </select>
        </div>
        )}

        {!selectedId ? (
          <div className="mt-6 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            Escolha uma pessoa acima para ver e definir as comissões dela.
          </div>
        ) : products.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            Nenhum procedimento cadastrado ainda — cadastre em Produtos/Serviços.
          </div>
        ) : (
          <>
            {/* Regra que vale pra tudo */}
            <div className="mt-6 rounded-xl border border-line bg-surface/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {embutido ? 'Comissão padrão' : `Comissão padrão de ${selected?.name}`}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    Vale para todo procedimento que não tiver valor próprio na tabela abaixo.
                  </div>
                </div>
                {editingKey === '__geral__' ? (
                  <EditorValor
                    tipo={editType}
                    valor={editValue}
                    onTipo={setEditType}
                    onValor={setEditValue}
                    onSalvar={() => salvar(null)}
                    onCancelar={cancelEdit}
                    busy={busy}
                    rotulo="Comissão padrão"
                  />
                ) : (
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-ink">
                      {regraGeral ? mostraValor(regraGeral) : 'não definida'}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit('__geral__', regraGeral)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg border border-line bg-card text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50"
                    >
                      {regraGeral ? 'Alterar' : 'Definir'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Detalhe: tabela de procedimentos da pessoa */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-2 pr-3 font-semibold text-muted text-xs uppercase tracking-wider">
                      Procedimento
                    </th>
                    <th scope="col" className="py-2 px-3 font-semibold text-muted text-xs uppercase tracking-wider text-right">
                      Valor
                    </th>
                    <th scope="col" className="py-2 px-3 font-semibold text-muted text-xs uppercase tracking-wider text-right">
                      Comissão
                    </th>
                    <th scope="col" className="py-2 px-3 font-semibold text-muted text-xs uppercase tracking-wider text-right">
                      Faz
                    </th>
                    <th scope="col" className="py-2 pl-3 text-right">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(({ prod, regra }) => {
                    const isEditing = editingKey === prod.id;
                    return (
                      <tr key={prod.id} className="border-b border-line/60">
                        <td className={`py-2.5 pr-3 ${faz(prod.id) ? 'text-ink' : 'text-muted'}`}>
                          {prod.name}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted tabular-nums">
                          {formatBRL(prod.price)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {isEditing ? null : regra ? (
                            <span className="font-semibold text-ink tabular-nums">
                              {mostraValor(regra)}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={faz(prod.id)}
                              aria-label={`${prod.name} — esta pessoa faz`}
                              onClick={() => void alternarFaz(prod.id)}
                              className={`h-5 w-9 rounded-full transition-colors relative block ${
                                faz(prod.id) ? 'bg-brand-600' : 'bg-line'
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                                  faz(prod.id) ? 'left-[1.125rem]' : 'left-0.5'
                                }`}
                              />
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 pl-3">
                          {isEditing ? (
                            <EditorValor
                              tipo={editType}
                              valor={editValue}
                              onTipo={setEditType}
                              onValor={setEditValue}
                              onSalvar={() => salvar(prod.name)}
                              onCancelar={cancelEdit}
                              busy={busy}
                              rotulo={`Comissão de ${prod.name}`}
                            />
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEdit(prod.id, regra)}
                                disabled={busy}
                                className="px-3 py-1.5 rounded-lg border border-line bg-card text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50"
                              >
                                {regra ? 'Alterar' : 'Definir'}
                              </button>
                              {regra && (
                                <button
                                  type="button"
                                  onClick={() => remover(regra)}
                                  disabled={busy}
                                  className="px-2 py-1.5 rounded-lg border border-line bg-card hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                  aria-label={`Apagar comissão de ${prod.name}`}
                                  title="Apagar (só para corrigir lançamento errado)"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
    </>
  );

  if (embutido) return <div className="mt-3">{conteudo}</div>;
  return (
    <div className="mb-12">
      <div className="bg-card border border-line rounded-2xl p-6">{conteudo}</div>
    </div>
  );
};

/** Editor inline de valor: tipo (R$ ou %) + campo + salvar/cancelar. */
const EditorValor: React.FC<{
  tipo: CommissionAmountType;
  valor: string;
  onTipo: (t: CommissionAmountType) => void;
  onValor: (v: string) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  busy: boolean;
  rotulo: string;
}> = ({ tipo, valor, onTipo, onValor, onSalvar, onCancelar, busy, rotulo }) => (
  <div className="flex items-center justify-end gap-1.5">
    <select
      aria-label={`Tipo da ${rotulo}`}
      value={tipo}
      onChange={(e) => onTipo(e.target.value as CommissionAmountType)}
      className="px-2 py-1.5 rounded-lg border border-line bg-card text-ink text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/40"
    >
      <option value="fixed">R$</option>
      <option value="percent">%</option>
    </select>
    <input
      aria-label={rotulo}
      value={valor}
      onChange={(e) => onValor(e.target.value)}
      inputMode="decimal"
      className="w-24 px-2 py-1.5 rounded-lg border border-line bg-card text-ink text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-500/40"
    />
    <button
      type="button"
      onClick={onSalvar}
      disabled={busy}
      className="px-2 py-1.5 rounded-lg border border-line bg-card hover:bg-surface disabled:opacity-50"
      aria-label="Salvar"
      title="Salvar — vale de hoje em diante"
    >
      <Save className="h-3.5 w-3.5 text-brand-500" />
    </button>
    <button
      type="button"
      onClick={onCancelar}
      className="px-2 py-1.5 rounded-lg border border-line bg-card hover:bg-surface"
      aria-label="Cancelar"
    >
      <X className="h-3.5 w-3.5 text-muted" />
    </button>
  </div>
);
