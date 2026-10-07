'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, ChevronRight, FlaskConical, Loader2, Pencil, Save, Send, X } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import { PageLoader } from '@/components/PageLoader';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';
import { VARIAVEIS_DO_PROMPT, verificarPrompt } from '@/lib/agents/verificarPrompt';
import { ErroDaApi, agentesApi } from './agentesApi';
import { DialogoPublicar } from './DialogoPublicar';
import { HistoricoDeVersoes } from './HistoricoDeVersoes';
import { LeituraDoPrompt } from './LeituraDoPrompt';
import { PainelDaVerificacao, resumoDaVerificacao } from './PainelDaVerificacao';
import { descreverVersao, formatarDataHora } from './formatos';

const PROXIMA_ENTREGA = 'Chega na próxima entrega';

/** As sete seções do mockup aprovado em 29/09. Nesta fatia só o Prompt abre. */
const SECOES = [
  { id: 'prompt', titulo: 'Prompt', subtitulo: 'Instruções e versões', ativa: true },
  { id: 'comportamento', titulo: 'Comportamento', subtitulo: 'Agrupar, dividir, memória, cutucada', ativa: false },
  { id: 'acoes', titulo: 'Ações', subtitulo: 'Agenda, etiquetas, repasse', ativa: false },
  { id: 'canais', titulo: 'Canais e funis', subtitulo: 'Números e funis que usam', ativa: false },
  { id: 'modelo', titulo: 'Modelo e custo', subtitulo: 'Modelo, tempo, custo', ativa: false },
  { id: 'conhecimento', titulo: 'Conhecimento', subtitulo: 'Blocos e base (fases 2 e 3)', ativa: false },
  { id: 'numeros', titulo: 'Números', subtitulo: 'Conversas, repasses, falhas', ativa: false },
] as const;

const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-card dark:text-slate-200';
const BOTAO_PRINCIPAL =
  'inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Cópia local do texto não salvo. O `beforeunload` só protege o fechar da aba: navegar por um link interno (a trilha,
 * o menu, o seletor de cliente) desmonta o editor sem aviso (revisão do Codex, rodada 1). Com a cópia, quem volta ao
 * agente recupera o texto. Rodada 2:
 * - a chave leva a instância do editor: cada aba grava a SUA cópia, e salvar apaga só a dela, então outra aba com
 *   texto não salvo do mesmo agente nunca perde o dela;
 * - a cópia guarda a revisão em que o texto se baseou: recuperá-la depois de outra pessoa salvar cai no conflito.
 * Armazenamento indisponível (janela anônima, bloqueio) só desliga a recuperação; a tela funciona igual.
 * Rodada 3: recuperar ou descartar a cópia de uma aba que ainda está ABERTA não a apaga. A aba dona pode sair depois
 * sem digitar de novo, e a cópia é o que salva o texto dela. Cada editor aberto deixa um sinal de vida, renovado a cada
 * 20 s e removido ao sair; sem sinal recente, a aba dona fechou e a cópia é órfã, e aí sim recuperar a traz para cá.
 */
type CopiaLocal = { chave: string; texto: string; revisao: number; em: string; daAbaAberta: boolean };
const prefixoDaCopia = (tenantId: string, agentId: string) => `central-agentes:texto-nao-salvo:${tenantId}:${agentId}:`;
const prefixoDoEditorAberto = (tenantId: string, agentId: string) => `central-agentes:editor-aberto:${tenantId}:${agentId}:`;
const BATIMENTO_MS = 20_000;
/** Sem sinal de vida há mais que isso, a aba dona fechou (ou travou). */
const ABA_ABERTA_MS = 60_000;
/** Sinal de vida esquecido por uma aba que travou sai depois de um dia. */
const SINAL_ESQUECIDO_MS = 24 * 60 * 60 * 1000;
const novaInstancia = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** A instância dona da cópia ainda está aberta (sinal de vida recente)? Erro de leitura conta como fechada. */
function abaAberta(prefixoVivo: string, instancia: string): boolean {
  try {
    const sinal = JSON.parse(window.localStorage.getItem(`${prefixoVivo}${instancia}`) ?? 'null') as { em?: unknown } | null;
    const em = typeof sinal?.em === 'string' ? Date.parse(sinal.em) : NaN;
    return Number.isFinite(em) && Date.now() - em < ABA_ABERTA_MS;
  } catch {
    return false;
  }
}

/**
 * A cópia mais recente deste agente, de outra aba, diferente do texto salvo e não escondida nesta aba. As iguais ao
 * salvo e as ilegíveis saem. A própria cópia deste editor nunca aparece aqui.
 */
function procurarCopia(
  prefixo: string,
  salvo: string,
  opcoes: { prefixoVivo: string; minhaChave: string; ocultas: ReadonlySet<string> },
): CopiaLocal | null {
  try {
    const chaves: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const chave = window.localStorage.key(i);
      if (chave?.startsWith(prefixo) && chave !== opcoes.minhaChave && !opcoes.ocultas.has(chave)) chaves.push(chave);
    }
    let maisRecente: CopiaLocal | null = null;
    for (const chave of chaves) {
      let lida: Partial<CopiaLocal> | null = null;
      try {
        lida = JSON.parse(window.localStorage.getItem(chave) ?? 'null') as Partial<CopiaLocal> | null;
      } catch {
        lida = null;
      }
      if (
        !lida || typeof lida.texto !== 'string' || typeof lida.em !== 'string' || typeof lida.revisao !== 'number' ||
        lida.texto === salvo
      ) {
        window.localStorage.removeItem(chave);
        continue;
      }
      if (!maisRecente || lida.em > maisRecente.em) {
        maisRecente = {
          chave,
          texto: lida.texto,
          revisao: lida.revisao,
          em: lida.em,
          daAbaAberta: abaAberta(opcoes.prefixoVivo, chave.slice(prefixo.length)),
        };
      }
    }
    return maisRecente;
  } catch {
    return null;
  }
}

function gravarCopia(chave: string, texto: string, revisao: number) {
  try {
    window.localStorage.setItem(chave, JSON.stringify({ texto, revisao, em: new Date().toISOString() }));
  } catch {
    // Sem armazenamento, sem recuperação: o aviso do navegador ao fechar a aba continua valendo.
  }
}

function apagarCopia(chave: string) {
  try {
    window.localStorage.removeItem(chave);
  } catch {
    // Idem.
  }
}

/** Editor de um agente (Central de Agentes, fatia 2). Só agency_admin e o legado admin; a API recusa os outros. */
export function AgentEditorPage({ tenantId, agentId }: { tenantId: string; agentId: string }) {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAgencyAdminRole(profile?.role)) {
    return <AccessDenied message="A Central de Agentes é da agência. Fale com quem administra a sua conta." />;
  }
  return <EditorDoAgente tenantId={tenantId} agentId={agentId} />;
}

function EditorDoAgente({ tenantId, agentId }: { tenantId: string; agentId: string }) {
  const { addToast } = useToast();
  const [agente, setAgente] = React.useState<AgenteNoEditor | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);
  // `base`: a revisão do rascunho em que o texto em edição se baseou; todo salvar comum manda ela (rodada 2).
  const [edicao, setEdicao] = React.useState<{ ativa: boolean; texto: string; base: number }>({ ativa: false, texto: '', base: 0 });
  const [salvando, setSalvando] = React.useState(false);
  const [publicando, setPublicando] = React.useState(false);
  const [aba, setAba] = React.useState<'instrucoes' | 'versoes'>('instrucoes');
  // Outra aba ou pessoa salvou antes: a mensagem fica na tela e o texto de quem editava continua no campo.
  const [conflito, setConflito] = React.useState<string | null>(null);
  const [copia, setCopia] = React.useState<CopiaLocal | null>(null);
  const campo = React.useRef<HTMLTextAreaElement>(null);
  const prefixo = prefixoDaCopia(tenantId, agentId);
  const prefixoVivo = prefixoDoEditorAberto(tenantId, agentId);
  // A instância deste editor: a chave da cópia leva ela, e só ela sai ao salvar ou descartar (rodada 2, achado 2); o
  // sinal de vida também (rodada 3, achado 2).
  const [instancia] = React.useState(novaInstancia);
  const minhaChave = `${prefixo}${instancia}`;
  // Cópias de abas ABERTAS que esta aba recuperou ou descartou: somem só daqui, sem apagar a da outra aba.
  const [ocultas, setOcultas] = React.useState<ReadonlySet<string>>(() => new Set());
  const procurouCopia = React.useRef(false);

  // Sinal de vida deste editor: outra aba só apaga a cópia de uma aba que fechou (revisão do Codex, rodada 3).
  React.useEffect(() => {
    const chaveViva = `${prefixoVivo}${instancia}`;
    const bater = () => {
      try {
        window.localStorage.setItem(chaveViva, JSON.stringify({ em: new Date().toISOString() }));
      } catch {
        // Sem armazenamento não há cópia, então não há o que sinalizar.
      }
    };
    const parar = () => {
      try {
        window.localStorage.removeItem(chaveViva);
      } catch {
        // Idem.
      }
    };
    try {
      // Sinais esquecidos por abas que travaram (sem `pagehide` nem desmontagem) saem depois de um dia.
      for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
        const chave = window.localStorage.key(i);
        if (!chave?.startsWith(prefixoVivo)) continue;
        const sinal = JSON.parse(window.localStorage.getItem(chave) ?? 'null') as { em?: unknown } | null;
        const em = typeof sinal?.em === 'string' ? Date.parse(sinal.em) : NaN;
        if (!Number.isFinite(em) || Date.now() - em > SINAL_ESQUECIDO_MS) window.localStorage.removeItem(chave);
      }
    } catch {
      // Idem.
    }
    bater();
    const relogio = window.setInterval(bater, BATIMENTO_MS);
    window.addEventListener('pagehide', parar);
    return () => {
      window.clearInterval(relogio);
      window.removeEventListener('pagehide', parar);
      parar();
    };
  }, [prefixoVivo, instancia]);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await agentesApi.ler(tenantId, agentId);
      setAgente(r.agente);
      // Na primeira leitura: a cópia mais recente deste agente, de qualquer aba, diferente do texto salvo, vira o
      // aviso de recuperação; as iguais ao salvo são lixo e saem. Feito aqui e não num efeito, sem setState síncrono
      // dentro de efeito.
      if (!procurouCopia.current) {
        procurouCopia.current = true;
        setCopia(
          procurarCopia(prefixo, r.agente.rascunho.prompt ?? r.agente.publicada?.prompt ?? '', {
            prefixoVivo,
            minhaChave,
            ocultas: new Set(),
          }),
        );
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o agente.');
    } finally {
      setCarregando(false);
    }
  }, [tenantId, agentId, prefixo, prefixoVivo, minhaChave]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  const publicado = agente?.publicada?.prompt ?? null;
  const salvo = agente?.rascunho.prompt ?? publicado ?? '';
  const textoAtual = edicao.ativa ? edicao.texto : salvo;
  const sujo = edicao.ativa && edicao.texto !== salvo;
  const rascunhoComMudancas = agente?.rascunho.prompt != null && agente.rascunho.prompt !== publicado;
  const comAgenda = agente ? agente.numeros.filter((n) => n.temAgenda).length : 0;
  const verificacao = React.useMemo(
    () => verificarPrompt({ rascunho: textoAtual, publicado, numerosLigadosComAgenda: comAgenda }),
    [textoAtual, publicado, comAgenda],
  );

  // Fechar a aba com edição não salva pede confirmação do navegador.
  React.useEffect(() => {
    if (!sujo) return;
    const segurar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [sujo]);

  // Cada mudança não salva vai para a cópia deste editor (navegação interna não passa pelo beforeunload), com a
  // revisão em que o texto se baseou.
  React.useEffect(() => {
    if (sujo) gravarCopia(minhaChave, edicao.texto, edicao.base);
  }, [sujo, edicao.texto, edicao.base, minhaChave]);

  const motivoSemPublicar = edicao.ativa
    ? 'Salve ou cancele a edição antes de publicar.'
    : !rascunhoComMudancas
      ? 'O rascunho é igual à versão publicada.'
      : verificacao.erros.length > 0
        ? 'Corrija os erros da verificação antes de publicar.'
        : null;

  const salvar = async (porCima = false) => {
    if (!agente) return;
    setSalvando(true);
    try {
      // A revisão em que o texto se baseou, não a última lida: um salvar comum nunca passa por cima do que outra
      // pessoa salvou depois que este texto começou (rodada 2, achado 1). Só "Salvar o meu por cima" manda a atual.
      const revisao = porCima ? agente.rascunho.revisao : edicao.base;
      await agentesApi.salvarRascunho(tenantId, agentId, { prompt: edicao.texto, revisao });
      addToast('Rascunho salvo.', 'success');
      apagarCopia(minhaChave);
      setConflito(null);
      setEdicao({ ativa: false, texto: '', base: 0 });
      await carregar();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao salvar o rascunho.', 'error');
      if (e instanceof ErroDaApi && e.status === 409) {
        // O texto de quem editava NÃO some (revisão do Codex, 07/10): recarrega para ter a revisão e o texto atuais
        // e deixa a escolha explícita, salvar o meu por cima ou descartar o meu.
        setConflito(e.message);
        await carregar();
      }
    } finally {
      setSalvando(false);
    }
  };

  const descartarOMeu = () => {
    apagarCopia(minhaChave);
    setConflito(null);
    setEdicao({ ativa: false, texto: '', base: 0 });
  };

  const cancelar = () => {
    if (!sujo || window.confirm('Descartar as mudanças não salvas?')) descartarOMeu();
  };

  const inserirVariavel = (nome: string) => {
    const marcador = `{{${nome}}}`;
    const el = campo.current;
    setEdicao((atual) => {
      const inicio = el?.selectionStart ?? atual.texto.length;
      const fim = el?.selectionEnd ?? atual.texto.length;
      return { ...atual, ativa: true, texto: atual.texto.slice(0, inicio) + marcador + atual.texto.slice(fim) };
    });
  };

  if (carregando && !agente) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-500" aria-label="Carregando" />
      </div>
    );
  }
  if (erro || !agente) {
    return (
      <div role="alert" className="mx-auto mt-8 max-w-xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        {erro ?? 'Agente não encontrado.'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <nav aria-label="Trilha" className="flex flex-wrap items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
        <Link href={`/platform/tenants/${tenantId}/agents`} className="hover:text-slate-900 dark:hover:text-white">
          Central de Agentes
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>{agente.cliente.nome}</span>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="font-medium text-slate-900 dark:text-white">{agente.nome}</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Bot size={22} aria-hidden="true" className="text-brand-700 dark:text-brand-300" />
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{agente.nome}</h1>
          <span
            className={
              agente.numeros.length > 0
                ? 'rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200'
                : 'rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200'
            }
          >
            {agente.numeros.length === 0
              ? 'Nenhum número ligado'
              : `Atendendo ${agente.numeros.length === 1 ? '1 número' : `${agente.numeros.length} números`}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled title={PROXIMA_ENTREGA} className={BOTAO_SECUNDARIO}>
            <FlaskConical size={16} aria-hidden="true" />
            Testar sem enviar
          </button>
          <button
            type="button"
            onClick={() => setPublicando(true)}
            disabled={motivoSemPublicar !== null}
            title={motivoSemPublicar ?? undefined}
            className={BOTAO_PRINCIPAL}
          >
            <Send size={16} aria-hidden="true" />
            Publicar
          </button>
        </div>
      </header>

      <section aria-label="Versão" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-card">
        <span className="text-slate-800 dark:text-slate-100">
          {agente.publicada ? descreverVersao(agente.publicada) : 'Sem versão publicada'}
        </span>
        {rascunhoComMudancas ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            Rascunho com mudanças
          </span>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">Sem mudanças no rascunho</span>
        )}
        {rascunhoComMudancas && agente.rascunho.atualizadoEm ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {`salvo em ${formatarDataHora(agente.rascunho.atualizadoEm)}${agente.rascunho.atualizadoPor ? ` por ${agente.rascunho.atualizadoPor}` : ''}`}
          </span>
        ) : null}
        <span className="text-xs text-slate-500 dark:text-slate-400">{resumoDaVerificacao(verificacao)}</span>
      </section>

      {copia && !edicao.ativa ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <span>{`Você tem um texto não salvo deste agente, de ${formatarDataHora(copia.em)}.`}</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAba('instrucoes');
                // O texto vem para este editor, com a mesma base. Base diferente da revisão atual: outra pessoa salvou
                // depois que este texto começou, e a escolha é explícita (rodada 2, achado 1). A cópia de uma aba
                // FECHADA sai de lá; a de uma aba ABERTA fica com ela e só some daqui (rodada 3, achado 2).
                if (copia.daAbaAberta) setOcultas((atuais) => new Set(atuais).add(copia.chave));
                else apagarCopia(copia.chave);
                setEdicao({ ativa: true, texto: copia.texto, base: copia.revisao });
                if (copia.revisao !== agente.rascunho.revisao) {
                  setConflito('O rascunho foi alterado depois que este texto foi escrito.');
                }
                setCopia(null);
              }}
              className={BOTAO_SECUNDARIO}
            >
              Recuperar o texto
            </button>
            <button
              type="button"
              onClick={() => {
                // Descartar a cópia de uma aba ABERTA só a esconde nesta aba; a de uma aba fechada sai de vez.
                const ocultasAgora = new Set(ocultas).add(copia.chave);
                if (copia.daAbaAberta) setOcultas(ocultasAgora);
                else apagarCopia(copia.chave);
                setCopia(procurarCopia(prefixo, salvo, { prefixoVivo, minhaChave, ocultas: ocultasAgora }));
              }}
              className={BOTAO_SECUNDARIO}
            >
              Descartar
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Seções do agente" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {SECOES.map((secao) => (
            <button
              key={secao.id}
              type="button"
              disabled={!secao.ativa}
              aria-current={secao.ativa ? 'page' : undefined}
              title={secao.ativa ? undefined : PROXIMA_ENTREGA}
              className={
                secao.ativa
                  ? 'min-w-[160px] rounded-xl border border-brand-300 bg-brand-50 px-3 py-2 text-left dark:border-brand-500/40 dark:bg-brand-500/10'
                  : 'min-w-[160px] cursor-not-allowed rounded-xl border border-transparent px-3 py-2 text-left opacity-60'
              }
            >
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">{secao.titulo}</span>
              <span className="block text-xs text-slate-600 dark:text-slate-400">
                {secao.ativa ? secao.subtitulo : `${secao.subtitulo} · ${PROXIMA_ENTREGA}`}
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          <div role="tablist" aria-label="Prompt" className="flex gap-1 border-b border-slate-200 dark:border-white/10">
            {([['instrucoes', 'Instruções'], ['versoes', 'Versões']] as const).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={aba === id}
                disabled={edicao.ativa && aba !== id}
                title={edicao.ativa && aba !== id ? 'Salve ou cancele a edição antes.' : undefined}
                onClick={() => setAba(id)}
                className={`relative px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  aba === id
                    ? 'text-brand-700 dark:text-brand-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {rotulo}
                {aba === id ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" /> : null}
              </button>
            ))}
          </div>
          {aba === 'versoes' ? (
            <HistoricoDeVersoes
              tenantId={tenantId}
              agentId={agentId}
              versaoPublicada={agente.publicada?.versao ?? 0}
              revisao={agente.rascunho.revisao}
              onMudou={() => void carregar()}
            />
          ) : edicao.ativa ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Editando o rascunho</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {`${edicao.texto.length.toLocaleString('pt-BR')} caracteres`}
                </span>
              </div>
              {conflito ? (
                <div
                  role="alert"
                  className="mb-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                >
                  <p>{`${conflito} O seu texto continua aqui, sem salvar.`}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void salvar(true)} disabled={salvando} className={BOTAO_SECUNDARIO}>
                      Salvar o meu por cima
                    </button>
                    <button type="button" onClick={descartarOMeu} disabled={salvando} className={BOTAO_SECUNDARIO}>
                      Descartar o meu e ver o atual
                    </button>
                  </div>
                </div>
              ) : null}
              <div role="group" aria-label="Inserir variável" className="mb-3 flex flex-wrap gap-1.5">
                {VARIAVEIS_DO_PROMPT.map((nome) => (
                  <button
                    key={nome}
                    type="button"
                    onClick={() => inserirVariavel(nome)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-800 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200"
                  >
                    {`{{${nome}}}`}
                  </button>
                ))}
              </div>
              <label htmlFor="prompt-do-agente" className="sr-only">Prompt do agente</label>
              <textarea
                id="prompt-do-agente"
                ref={campo}
                value={edicao.texto}
                spellCheck={false}
                onChange={(e) => {
                  const texto = e.target.value;
                  setEdicao((atual) => ({ ...atual, ativa: true, texto }));
                }}
                className="min-h-[480px] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm leading-6 text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-card dark:text-white"
              />
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={cancelar} disabled={salvando} className={BOTAO_SECUNDARIO}>
                  <X size={14} aria-hidden="true" />
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void salvar()}
                  disabled={salvando || !sujo || conflito !== null || edicao.texto.length === 0 || edicao.texto.length > 50_000}
                  className={BOTAO_PRINCIPAL}
                >
                  {salvando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                  Salvar rascunho
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  {rascunhoComMudancas ? 'Rascunho' : 'Prompt publicado'}
                </h2>
                <button
                  type="button"
                  onClick={() => setEdicao({ ativa: true, texto: salvo, base: agente.rascunho.revisao })}
                  className={BOTAO_SECUNDARIO}
                >
                  <Pencil size={14} aria-hidden="true" />
                  Editar
                </button>
              </div>
              <LeituraDoPrompt texto={salvo} />
            </div>
          )}
          {aba === 'instrucoes' ? <PainelDaVerificacao verificacao={verificacao} /> : null}
        </div>
      </div>

      {publicando ? (
        <DialogoPublicar
          tenantId={tenantId}
          agente={agente}
          verificacao={verificacao}
          onFechar={() => setPublicando(false)}
          onPublicado={(versao) => {
            setPublicando(false);
            addToast(`Versão ${versao} publicada. As respostas que começarem a partir de agora já saem com ela.`, 'success');
            void carregar();
          }}
          onConflito={(mensagem) => {
            setPublicando(false);
            addToast(mensagem, 'error');
            void carregar();
          }}
        />
      ) : null}
    </div>
  );
}
