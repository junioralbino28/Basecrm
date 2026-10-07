'use client';

import React from 'react';
import { GitCompare, History, Loader2, RotateCcw } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import { compararAjustes, compararLinhas } from '@/lib/agents/compararVersoes';
import type { VersaoCompleta, VersaoResumo } from '@/lib/agents/tiposDoEditor';
import { ErroDaApi, agentesApi } from './agentesApi';
import { descreverVersao } from './formatos';

const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-card dark:text-slate-200';

/** Histórico do agente: autor, data e nota de cada versão; comparar quaisquer duas; restaurar uma como versão nova. */
export function HistoricoDeVersoes(props: {
  tenantId: string;
  agentId: string;
  versaoPublicada: number;
  revisao: number;
  onMudou: () => void;
}) {
  const { tenantId, agentId, versaoPublicada, revisao, onMudou } = props;
  const { addToast } = useToast();
  const [versoes, setVersoes] = React.useState<VersaoResumo[] | null>(null);
  const [temMais, setTemMais] = React.useState(false);
  const [carregandoMais, setCarregandoMais] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [selecionadas, setSelecionadas] = React.useState<number[]>([]);
  const [comparacao, setComparacao] = React.useState<{ antes: VersaoCompleta; depois: VersaoCompleta } | null>(null);
  const [comparando, setComparando] = React.useState(false);
  const [restaurar, setRestaurar] = React.useState<number | null>(null);
  // O ConfirmModal fecha logo depois do onConfirm: sem esta trava, a mesma restauração podia ser pedida de novo
  // antes de a primeira responder (revisão do Codex, 07/10).
  const [restaurando, setRestaurando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    setErro(null);
    try {
      const pagina = await agentesApi.listarVersoes(tenantId, agentId);
      setVersoes(pagina.versoes);
      setTemMais(pagina.temMais);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o histórico.');
    }
  }, [tenantId, agentId]);

  // Página seguinte: as versões de número menor que a última carregada. Qualquer versão continua alcançável.
  const carregarMais = async () => {
    if (!versoes?.length) return;
    setCarregandoMais(true);
    try {
      const pagina = await agentesApi.listarVersoes(tenantId, agentId, versoes[versoes.length - 1].versao);
      setVersoes((atual) => [...(atual ?? []), ...pagina.versoes]);
      setTemMais(pagina.temMais);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao carregar as versões anteriores.', 'error');
    } finally {
      setCarregandoMais(false);
    }
  };

  // Recarrega quando a versão publicada muda (publicar ou restaurar no editor).
  React.useEffect(() => {
    void carregar();
  }, [carregar, versaoPublicada]);

  const alternar = (versao: number) =>
    setSelecionadas((atual) => (atual.includes(versao) ? atual.filter((v) => v !== versao) : [...atual, versao].slice(-2)));

  const [menor, maior] = [...selecionadas].sort((x, y) => x - y);

  const comparar = async () => {
    setComparando(true);
    try {
      const [antes, depois] = await Promise.all([
        agentesApi.lerVersao(tenantId, agentId, menor),
        agentesApi.lerVersao(tenantId, agentId, maior),
      ]);
      setComparacao({ antes: antes.versao, depois: depois.versao });
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao comparar as versões.', 'error');
    } finally {
      setComparando(false);
    }
  };

  const confirmarRestauracao = async (versao: number) => {
    setRestaurando(true);
    try {
      const r = await agentesApi.restaurar(tenantId, agentId, { versao, versaoEsperada: versaoPublicada, revisao });
      // O runtime lê a versão antes de gerar: uma resposta que já estava em curso ainda sai com a anterior.
      addToast(
        `Versão ${versao} restaurada como versão ${r.versao}. As respostas que começarem a partir de agora já saem com ela.`,
        'success',
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao restaurar.', 'error');
      if (!(e instanceof ErroDaApi && e.status === 409)) return;
    } finally {
      setRestaurando(false);
    }
    setComparacao(null);
    setSelecionadas([]);
    onMudou();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <History size={16} aria-hidden="true" />
            Versões
          </h2>
          <button
            type="button"
            onClick={() => void comparar()}
            disabled={selecionadas.length !== 2 || comparando}
            className={BOTAO_SECUNDARIO}
          >
            {comparando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <GitCompare size={14} aria-hidden="true" />}
            {selecionadas.length === 2 ? `Comparar a versão ${menor} com a ${maior}` : 'Marque duas versões para comparar'}
          </button>
        </div>
        {erro ? (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{erro}</p>
        ) : versoes === null ? (
          <Loader2 size={18} className="animate-spin text-slate-500" aria-label="Carregando" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {versoes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                <input
                  type="checkbox"
                  checked={selecionadas.includes(v.versao)}
                  onChange={() => alternar(v.versao)}
                  aria-label={`Comparar a versão ${v.versao}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 dark:text-slate-100">{descreverVersao(v)}</p>
                  {v.nota ? <p className="text-xs text-slate-500 dark:text-slate-400">{`Nota: ${v.nota}`}</p> : null}
                </div>
                {v.versao === versaoPublicada ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200">
                    Publicada
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRestaurar(v.versao)}
                    disabled={restaurando}
                    className={BOTAO_SECUNDARIO}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    {`Restaurar a versão ${v.versao}`}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {versoes && temMais ? (
          <button type="button" onClick={() => void carregarMais()} disabled={carregandoMais} className={`${BOTAO_SECUNDARIO} mt-3`}>
            {carregandoMais ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            Carregar versões anteriores
          </button>
        ) : null}
      </div>

      {comparacao ? <Comparacao antes={comparacao.antes} depois={comparacao.depois} /> : null}

      <ConfirmModal
        isOpen={restaurar !== null}
        onClose={() => setRestaurar(null)}
        onConfirm={() => {
          if (restaurar !== null) void confirmarRestauracao(restaurar);
        }}
        title={`Restaurar a versão ${restaurar ?? ''}?`}
        message={`O conteúdo dela vira a versão ${versaoPublicada + 1}, publicada agora, e o rascunho passa a ter esse texto. As respostas que começarem depois disso já saem com ela.`}
        confirmText="Restaurar"
        variant="primary"
      />
    </div>
  );
}

function Comparacao({ antes, depois }: { antes: VersaoCompleta; depois: VersaoCompleta }) {
  const linhas = React.useMemo(() => compararLinhas(antes.prompt, depois.prompt), [antes.prompt, depois.prompt]);
  const ajustes = React.useMemo(() => compararAjustes(antes, depois), [antes, depois]);
  return (
    <section aria-label="Comparação" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{`Da versão ${antes.versao} para a versão ${depois.versao}`}</h2>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Texto, linha a linha</h3>
        {linhas === null ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              O texto é grande demais para destacar linha a linha nesta tela. As duas versões aparecem lado a lado, inteiras.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[antes, depois].map((v) => (
                <pre
                  key={v.versao}
                  aria-label={`Texto da versão ${v.versao}`}
                  className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 p-3 font-mono text-xs leading-5 text-slate-700 dark:border-white/10 dark:text-slate-300"
                >
                  {v.prompt}
                </pre>
              ))}
            </div>
          </div>
        ) : linhas.every((l) => l.tipo === 'igual') ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">O texto é igual nas duas versões.</p>
        ) : (
          <div className="max-h-[480px] overflow-auto rounded-xl border border-slate-200 p-3 font-mono text-xs leading-5 dark:border-white/10">
            {linhas.map((l, i) => (
              <div
                key={i}
                data-tipo={l.tipo}
                className={
                  l.tipo === 'adicionada'
                    ? 'whitespace-pre-wrap bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : l.tipo === 'removida'
                      ? 'whitespace-pre-wrap bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200'
                      : 'whitespace-pre-wrap text-slate-600 dark:text-slate-400'
                }
              >
                <span aria-hidden="true">{l.tipo === 'adicionada' ? '+ ' : l.tipo === 'removida' ? '- ' : '  '}</span>
                <span className="sr-only">{l.tipo === 'adicionada' ? 'Linha adicionada: ' : l.tipo === 'removida' ? 'Linha removida: ' : ''}</span>
                {l.texto}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ajustes e modelo, campo a campo</h3>
        {ajustes.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Ajustes e modelo iguais nas duas versões.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 dark:text-slate-400">
                <th className="py-1 font-medium">Campo</th>
                <th className="py-1 font-medium">{`Versão ${antes.versao}`}</th>
                <th className="py-1 font-medium">{`Versão ${depois.versao}`}</th>
              </tr>
            </thead>
            <tbody>
              {ajustes.map((d) => (
                <tr key={d.campo} className="border-t border-slate-100 dark:border-white/5">
                  <td className="py-1 font-mono text-xs">{d.campo}</td>
                  <td className="py-1 font-mono text-xs">{d.antes}</td>
                  <td className="py-1 font-mono text-xs">{d.depois}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
