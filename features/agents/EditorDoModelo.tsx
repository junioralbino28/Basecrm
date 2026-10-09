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
  const [modelo, setModelo] = React.useState<ModeloCompleto | null>(null);
  const [carregando, setCarregando] = React.useState(!novo);
  const [erro, setErro] = React.useState<string | null>(null);
  const [nome, setNome] = React.useState('');
  const [descricao, setDescricao] = React.useState('');
  const [texto, setTexto] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    if (novo) return;
    setCarregando(true);
    setErro(null);
    try {
      const m = await agentesApi.modelos.ler(templateId);
      setModelo(m);
      setNome(m.nome);
      setDescricao(m.descricao ?? '');
      setTexto(m.prompt);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o modelo.');
    } finally {
      setCarregando(false);
    }
  }, [novo, templateId]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  const lacunas = lacunasDoTexto(texto);
  const ambiguas = lacunasAmbiguas(texto);
  const desconhecidas = verificarPrompt({ rascunho: texto, publicado: null, numerosLigadosComAgenda: 0 }).erros;
  const mudou = novo
    ? texto.length > 0 || nome.length > 0
    : modelo !== null && (nome !== modelo.nome || descricao !== (modelo.descricao ?? '') || texto !== modelo.prompt);
  const podeSalvar =
    !salvando && !modelo?.arquivado && mudou && nome.trim().length > 0 && texto.length > 0 && desconhecidas.length === 0;

  const salvar = async () => {
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
      if (!modelo) return;
      await agentesApi.modelos.salvar(modelo.id, { ...corpo, revisaoEsperada: modelo.revisao });
      addToast('Modelo salvo.', 'success');
      await carregar();
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 409) {
        addToast(e.message, 'error');
        await carregar();
      } else {
        setErro(e instanceof Error ? e.message : 'Falha ao salvar o modelo.');
      }
    } finally {
      setSalvando(false);
    }
  };

  const arquivar = async (arquivo: boolean) => {
    if (!modelo) return;
    setSalvando(true);
    setErro(null);
    try {
      await agentesApi.modelos.arquivar(modelo.id, { arquivar: arquivo, revisaoEsperada: modelo.revisao });
      addToast(arquivo ? 'Modelo arquivado.' : 'Modelo restaurado.', 'success');
      await carregar();
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 409) {
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
            <input id="nome-do-modelo" value={nome} maxLength={80} disabled={modelo?.arquivado} onChange={(e) => setNome(e.target.value)} className={CAMPO} />
          </div>
          <div>
            <label htmlFor="descricao-do-modelo" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
              Descrição (opcional)
            </label>
            <input
              id="descricao-do-modelo"
              value={descricao}
              maxLength={280}
              disabled={modelo?.arquivado}
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
              disabled={modelo?.arquivado}
              onChange={(e) => setTexto(e.target.value)}
              rows={22}
              className={`${CAMPO} font-mono`}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {modelo ? (
              <button type="button" onClick={() => void arquivar(!modelo.arquivado)} disabled={salvando} className={BOTAO_SECUNDARIO}>
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
