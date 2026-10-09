'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, ChevronRight, Loader2, Save } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import { PageLoader } from '@/components/PageLoader';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import type { ModeloCompleto } from '@/lib/agents/tiposDoEditor';
import { lacunasAmbiguas, lacunasDoTexto, verificarPrompt } from '@/lib/agents/verificarPrompt';
import { ErroDaApi, agentesApi } from './agentesApi';

const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-card dark:text-slate-200';
const BOTAO_PRINCIPAL =
  'inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50';
const CAMPO =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-white';

/** Bloco 2: o editor de um modelo da agência. `templateId === 'novo'` abre o formulário vazio e cria ao salvar. */
export function EditorDoModelo({ templateId }: { templateId: string }) {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAgencyAdminRole(profile?.role)) {
    return <AccessDenied message="Os modelos de agente são da agência. Fale com quem administra a sua conta." />;
  }
  return <Formulario templateId={templateId} />;
}

function Formulario({ templateId }: { templateId: string }) {
  const novo = templateId === 'novo';
  const router = useRouter();
  const { addToast } = useToast();
  /** O que o servidor tem agora. Os campos abaixo são o que a pessoa está escrevendo; um 409 nunca os sobrescreve. */
  const [modelo, setModelo] = React.useState<ModeloCompleto | null>(null);
  const [carregando, setCarregando] = React.useState(!novo);
  const [erro, setErro] = React.useState<string | null>(null);
  const [nome, setNome] = React.useState('');
  const [descricao, setDescricao] = React.useState('');
  const [texto, setTexto] = React.useState('');
  /** A revisão em que o texto se baseou: um salvar comum nunca passa por cima do que outra pessoa salvou depois. */
  const [base, setBase] = React.useState<number | null>(null);
  /**
   * Conflito de salvar (409). `atual` é a versão do servidor relida DEPOIS do conflito; enquanto ela não chega (ou a
   * releitura falhou), nenhuma escolha que mexa no texto fica disponível (revisão do Codex, código, rodada 2, achado 1).
   */
  const [conflito, setConflito] = React.useState<{ mensagem: string; atual: ModeloCompleto | null } | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  const aplicar = React.useCallback((m: ModeloCompleto) => {
    setModelo(m);
    setNome(m.nome);
    setDescricao(m.descricao ?? '');
    setTexto(m.prompt);
    setBase(m.revisao);
  }, []);

  const carregar = React.useCallback(async () => {
    if (novo) return;
    setCarregando(true);
    setErro(null);
    try {
      aplicar(await agentesApi.modelos.ler(templateId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o modelo.');
    } finally {
      setCarregando(false);
    }
  }, [aplicar, novo, templateId]);

  /** Relê só a cópia do servidor; os campos não mudam. Devolve null se a leitura falhar. */
  const lerAtual = React.useCallback(async (): Promise<ModeloCompleto | null> => {
    try {
      const m = await agentesApi.modelos.ler(templateId);
      setModelo(m);
      return m;
    } catch {
      return null;
    }
  }, [templateId]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  const lacunas = lacunasDoTexto(texto);
  const ambiguas = lacunasAmbiguas(texto);
  const desconhecidas = verificarPrompt({ rascunho: texto, publicado: null, numerosLigadosComAgenda: 0 }).erros;
  const mudou = novo
    ? texto.length > 0 || nome.length > 0
    : modelo !== null && (nome !== modelo.nome || descricao !== (modelo.descricao ?? '') || texto !== modelo.prompt);
  const camposValidos = nome.trim().length > 0 && texto.length > 0 && desconhecidas.length === 0;
  const podeSalvar = !salvando && !modelo?.arquivado && conflito === null && mudou && camposValidos;
  /** Durante o salvar os campos travam: o que fosse digitado ali sumiria na releitura (código, rodada 2, achado 2). */
  const camposTravados = salvando || Boolean(modelo?.arquivado);
  const motivoSemArquivar = conflito !== null || (mudou && !novo) ? 'Salve ou descarte as mudanças antes de arquivar.' : null;

  const salvar = async (porCima = false) => {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = { nome: nome.trim(), ...(descricao.trim() ? { descricao: descricao.trim() } : {}), prompt: texto };
      if (novo) {
        const r = await agentesApi.modelos.criar(corpo);
        addToast('Modelo criado.', 'success');
        router.replace(`/platform/agent-templates/${r.id}`);
        return;
      }
      if (!modelo || base === null) return;
      // Só "Salvar o meu por cima" manda a revisão da versão relida no conflito; o salvar comum manda a revisão de base.
      const revisaoEsperada = porCima && conflito?.atual ? conflito.atual.revisao : base;
      await agentesApi.modelos.salvar(modelo.id, { ...corpo, revisaoEsperada });
      addToast('Modelo salvo.', 'success');
      setConflito(null);
      await carregar();
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 409) {
        setConflito({ mensagem: e.message, atual: null });
        const atual = await lerAtual();
        setConflito({ mensagem: e.message, atual });
      } else {
        setErro(e instanceof Error ? e.message : 'Falha ao salvar o modelo.');
      }
    } finally {
      setSalvando(false);
    }
  };

  const descartarOMeu = () => {
    if (!conflito?.atual) return;
    aplicar(conflito.atual);
    setConflito(null);
  };

  const tentarLerDeNovo = async () => {
    if (!conflito) return;
    const atual = await lerAtual();
    setConflito((c) => (c ? { ...c, atual } : c));
  };

  const arquivar = async (arquivo: boolean) => {
    // Com mudanças não salvas o botão fica travado; esta conferência é a mesma regra, para não perder texto em silêncio.
    if (!modelo || motivoSemArquivar) return;
    setSalvando(true);
    setErro(null);
    try {
      await agentesApi.modelos.arquivar(modelo.id, { arquivar: arquivo, revisaoEsperada: modelo.revisao });
      addToast(arquivo ? 'Modelo arquivado.' : 'Modelo restaurado.', 'success');
      await carregar();
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 409) {
        // Sem mudanças pendentes (o botão exige isso), recarregar não apaga nada que a pessoa escreveu.
        addToast(e.message, 'error');
        await carregar();
      } else {
        setErro(e instanceof Error ? e.message : 'Falha ao arquivar o modelo.');
      }
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) return <PageLoader />;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
        <Link href="/platform/agent-templates" className="hover:underline">
          Modelos de agente
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="font-medium text-slate-900 dark:text-white">{novo ? 'Novo modelo' : modelo?.nome ?? 'Modelo'}</span>
      </nav>

      {modelo?.arquivado ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
          Este modelo está arquivado: não aparece no Novo agente e não pode ser editado. Restaure para voltar a usar.
        </div>
      ) : null}

      {conflito ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <p>{`${conflito.mensagem} O seu texto continua aqui, sem salvar.`}</p>
          {conflito.atual ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void salvar(true)} disabled={salvando || conflito.atual.arquivado} className={BOTAO_SECUNDARIO}>
                Salvar o meu por cima
              </button>
              <button type="button" onClick={descartarOMeu} disabled={salvando} className={BOTAO_SECUNDARIO}>
                Descartar o meu e ver o atual
              </button>
            </div>
          ) : salvando ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <span>Não deu para carregar a versão atual agora.</span>
              <button type="button" onClick={() => void tentarLerDeNovo()} className={BOTAO_SECUNDARIO}>
                Tentar de novo
              </button>
            </div>
          )}
        </div>
      ) : null}

      {erro ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {erro}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <div>
            <label htmlFor="nome-do-modelo" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
              Nome do modelo
            </label>
            <input id="nome-do-modelo" value={nome} maxLength={80} disabled={camposTravados} onChange={(e) => setNome(e.target.value)} className={CAMPO} />
          </div>
          <div>
            <label htmlFor="descricao-do-modelo" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
              Descrição (opcional)
            </label>
            <input
              id="descricao-do-modelo"
              value={descricao}
              maxLength={280}
              disabled={camposTravados}
              onChange={(e) => setDescricao(e.target.value)}
              className={CAMPO}
            />
          </div>
          <div>
            <label htmlFor="texto-do-modelo" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
              Texto do modelo
            </label>
            <textarea
              id="texto-do-modelo"
              value={texto}
              maxLength={50_000}
              disabled={camposTravados}
              onChange={(e) => setTexto(e.target.value)}
              rows={22}
              className={`${CAMPO} font-mono`}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {modelo ? (
              <button
                type="button"
                onClick={() => void arquivar(!modelo.arquivado)}
                disabled={salvando || motivoSemArquivar !== null}
                title={motivoSemArquivar ?? undefined}
                className={BOTAO_SECUNDARIO}
              >
                {modelo.arquivado ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
                {modelo.arquivado ? 'Restaurar' : 'Arquivar'}
              </button>
            ) : null}
            <button type="button" onClick={() => void salvar()} disabled={!podeSalvar} className={BOTAO_PRINCIPAL}>
              {salvando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {novo ? 'Criar modelo' : 'Salvar'}
            </button>
          </div>
        </div>

        <aside aria-label="Lacunas" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-card">
          <h2 className="font-semibold text-slate-900 dark:text-white">Lacunas</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Escreva entre colchetes, começando com maiúscula: [Nome da empresa]. Ao criar um agente, cada lacuna vira um campo.
          </p>
          {lacunas.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-300">Nenhuma lacuna no texto.</p>
          ) : (
            <ul className="space-y-1">
              {lacunas.map((l) => (
                <li key={l} className="text-slate-800 dark:text-slate-100">
                  {l}
                </li>
              ))}
            </ul>
          )}
          {ambiguas.length > 0 ? (
            <p className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              Também aparecem como texto de link e não poderão ser respondidas: {ambiguas.join(', ')}. Troque o texto do link.
            </p>
          ) : null}
          {desconhecidas.length > 0 ? (
            <ul className="space-y-1">
              {desconhecidas.map((d) => (
                <li key={d.codigo} className="rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
                  {d.mensagem}
                </li>
              ))}
            </ul>
          ) : null}
          {modelo ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {modelo.agentesCriados === 1 ? 'Usado em 1 agente.' : `Usado em ${modelo.agentesCriados} agentes.`} Mudar o modelo não mexe neles.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
