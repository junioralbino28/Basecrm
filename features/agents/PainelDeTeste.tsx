'use client';

import React from 'react';
import { FlaskConical, Loader2, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import type { AgenteNoEditor, MensagemSimulada, ResultadoDoTeste } from '@/lib/agents/tiposDoEditor';
import { ErroDaApi, agentesApi } from './agentesApi';
import { formatarDataHora } from './formatos';

/** Quantas mensagens o teste manda, contando a nova; a rota recusa acima disso. */
const MAXIMO_DE_MENSAGENS = 30;

type Turno = { tipo: 'lead'; texto: string } | { tipo: 'agente'; resultado: ResultadoDoTeste };
type Explicacao = { estado: 'carregando' } | { estado: 'pronta'; texto: string } | { estado: 'erro'; mensagem: string };
type Erro = { mensagem: string; recarregar: boolean };

const TIPO_DO_REPASSE: Record<string, string> = {
  call_accepted: 'o lead aceitou uma ligação',
  meeting_requested: 'o lead quer agendar uma reunião',
  meeting_confirmed: 'reunião confirmada',
  human_requested: 'o lead pediu atendimento humano',
  high_intent: 'lead com alta intenção',
  other: 'outro motivo',
};

const QUALIFICACAO: Record<'passed' | 'failed' | 'unanswered', string> = {
  passed: 'passou',
  failed: 'não passou',
  unanswered: 'ainda sem resposta',
};

const BOTAO =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-card dark:text-slate-200';
const CAMPO =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-card dark:text-white';

const segundos = (ms: number) => (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const numero = (n: number | null) => (n == null ? '?' : n.toLocaleString('pt-BR'));

function descreverHorario(h: { em: string | null; texto: string | null } | null): string | null {
  if (!h) return null;
  const data = h.em && Number.isFinite(Date.parse(h.em)) ? formatarDataHora(h.em) : null;
  if (data && h.texto) return `${data} ("${h.texto}")`;
  return data ?? h.texto;
}

/** Só o que veio preenchido, cada valor no seu elemento: tudo é texto do modelo e sai como texto (G16). */
function itensDoQueFez(r: ResultadoDoTeste): Array<{ rotulo: string; valor: string }> {
  const o = r.oQueFez;
  const itens: Array<{ rotulo: string; valor: string }> = [];
  if (o.repasse) {
    itens.push({ rotulo: 'Passaria para uma pessoa', valor: TIPO_DO_REPASSE[o.repasse.tipo] ?? o.repasse.tipo });
    if (o.repasse.motivo) itens.push({ rotulo: 'Motivo do repasse', valor: o.repasse.motivo });
  }
  const horario = descreverHorario(o.horarioPedido);
  if (o.repasse?.tipo === 'meeting_confirmed') {
    itens.push({
      rotulo: 'Reunião',
      valor: `Confirmaria a reunião de ${horario ?? 'horário combinado'} (simulação: no teste nada é reservado; no atendimento real, se a reserva falhar, o texto muda)`,
    });
  } else if (horario) {
    itens.push({ rotulo: 'Horário pedido', valor: horario });
  }
  if (o.lead.nome) itens.push({ rotulo: 'Nome captado', valor: o.lead.nome });
  if (o.lead.email) itens.push({ rotulo: 'E-mail captado', valor: o.lead.email });
  if (o.lead.empresa) itens.push({ rotulo: 'Empresa captada', valor: o.lead.empresa });
  if (o.lead.segmento) itens.push({ rotulo: 'Segmento', valor: o.lead.segmento });
  if (o.etiquetas?.length) itens.push({ rotulo: 'Etiquetas sugeridas', valor: o.etiquetas.join(', ') });
  if (o.gateDeCapacidade) itens.push({ rotulo: 'Qualificação de capacidade', valor: QUALIFICACAO[o.gateDeCapacidade] });
  if (o.resumo) itens.push({ rotulo: 'Resumo', valor: o.resumo });
  if (o.conversaEncerrada) itens.push({ rotulo: 'Conversa', valor: 'encerraria a conversa' });
  return itens;
}

/** Tokens, não dinheiro: o custo em reais é da fatia 5 (D9). */
function linhaDoUso(r: ResultadoDoTeste): string {
  const tokens =
    r.uso.entrada == null && r.uso.saida == null
      ? 'tokens não informados'
      : `${numero(r.uso.entrada)} tokens de entrada, ${numero(r.uso.saida)} de saída`;
  return `Respondeu em ${segundos(r.tempo.total_ms)} s (modelo ${segundos(r.tempo.model_ms)} s) · ${tokens} · modelo ${r.modelo}`;
}

const linhaDaVersao = (r: ResultadoDoTeste) =>
  r.prompt.origem === 'rascunho'
    ? `Testando o rascunho salvo (revisão ${r.prompt.revisao})`
    : `Testando a versão publicada ${r.prompt.versao ?? ''}`.trim();

function Balao({ autor, texto }: { autor: 'lead' | 'agente'; texto: string }) {
  return (
    <div className={`flex ${autor === 'agente' ? 'justify-end' : 'justify-start'}`}>
      <p
        data-autor={autor}
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] shadow-soft ${
          autor === 'agente'
            ? 'rounded-tr-md border border-brand-100 bg-brand-50 text-slate-900'
            : 'rounded-tl-md border border-slate-200 bg-white text-slate-900'
        }`}
      >
        {texto}
      </p>
    </div>
  );
}

/**
 * Gaveta "Testar sem enviar" do editor (Central de Agentes, fatia 3). A conversa vive só nesta tela: cada envio manda o
 * histórico simulado para a rota do teste, que responde com o texto salvo do agente sem enviar nem gravar nada.
 * Tudo o que o modelo devolve aparece como texto, nunca como HTML (G16).
 */
export function PainelDeTeste(props: {
  tenantId: string;
  agente: AgenteNoEditor;
  onFechar: () => void;
  /** O rascunho mudou no servidor: o editor relê o agente. */
  onMudou: () => void;
}) {
  const { tenantId, agente, onFechar, onMudou } = props;
  const [numeroId, setNumeroId] = React.useState(agente.numeros[0]?.id ?? '');
  const [nomeDoLead, setNomeDoLead] = React.useState('');
  const [turnos, setTurnos] = React.useState<Turno[]>([]);
  const [texto, setTexto] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<Erro | null>(null);
  const [explicacao, setExplicacao] = React.useState<Explicacao | null>(null);
  // Cada envio ou recomeço invalida a explicação pedida antes: a que chegar atrasada não cai sob a resposta errada.
  const geracao = React.useRef(0);
  const campo = React.useRef<HTMLTextAreaElement>(null);
  const fim = React.useRef<HTMLDivElement>(null);
  const tituloId = React.useId();
  const campoId = React.useId();

  React.useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  // O campo volta a ter o foco ao abrir e quando a resposta chega.
  React.useEffect(() => {
    if (!enviando) campo.current?.focus();
  }, [enviando]);

  React.useEffect(() => {
    fim.current?.scrollIntoView?.({ block: 'end' });
  }, [turnos, enviando, explicacao]);

  const enviar = async () => {
    const novo = texto.trim();
    if (!novo || enviando) return;
    const historico: MensagemSimulada[] = turnos.flatMap((t): MensagemSimulada[] =>
      t.tipo === 'lead' ? [{ autor: 'lead', texto: t.texto }] : t.resultado.partes.map((parte) => ({ autor: 'agente', texto: parte })),
    );
    const mensagens: MensagemSimulada[] = [...historico, { autor: 'lead' as const, texto: novo }].slice(-MAXIMO_DE_MENSAGENS);
    geracao.current += 1;
    setTurnos((atual) => [...atual, { tipo: 'lead', texto: novo }]);
    setTexto('');
    setErro(null);
    setExplicacao(null);
    setEnviando(true);
    try {
      const resultado = await agentesApi.testar(tenantId, agente.id, {
        revisao: agente.rascunho.revisao,
        mensagens,
        numeroId: numeroId || null,
        ...(nomeDoLead.trim() ? { nomeDoLead: nomeDoLead.trim() } : {}),
      });
      setTurnos((atual) => [...atual, { tipo: 'agente', resultado }]);
    } catch (e) {
      // O teste não aconteceu: a mensagem sai da conversa e volta para o campo, para tentar de novo sem redigitar.
      setTurnos((atual) => atual.slice(0, -1));
      setTexto(novo);
      setErro({
        mensagem: e instanceof Error ? e.message : 'Falha ao testar.',
        recarregar: e instanceof ErroDaApi && e.codigo === 'RASCUNHO_MUDOU',
      });
    } finally {
      setEnviando(false);
    }
  };

  const explicar = async (resultado: ResultadoDoTeste) => {
    if (!resultado.retrato) return;
    const minha = geracao.current;
    setExplicacao({ estado: 'carregando' });
    try {
      // Exatamente o que o teste devolveu: a assinatura do retrato cobre a revisão, as partes e o repasse (D7).
      const r = await agentesApi.explicar(tenantId, agente.id, {
        revisao: resultado.prompt.revisao,
        retrato: resultado.retrato,
        resposta: { partes: resultado.partes, repasse: resultado.oQueFez.repasse },
      });
      if (geracao.current === minha) setExplicacao({ estado: 'pronta', texto: r.explicacao });
    } catch (e) {
      if (geracao.current === minha) {
        setExplicacao({ estado: 'erro', mensagem: e instanceof Error ? e.message : 'Falha ao explicar.' });
      }
    }
  };

  const recomecar = () => {
    geracao.current += 1;
    setTurnos([]);
    setErro(null);
    setExplicacao(null);
  };

  const ultimo = turnos[turnos.length - 1];
  const resposta = ultimo?.tipo === 'agente' ? ultimo.resultado : null;
  const itens = resposta ? itensDoQueFez(resposta) : [];

  return (
    // Mesma camada do Sheet e do ActionSheet do app: acima da barra de navegação do celular (BottomNav, z-50), que
    // cobria o campo e o botão Enviar (ensaio da fatia 3, 08/10).
    <div className="fixed inset-0 z-[9999]">
      <div aria-hidden="true" data-testid="fundo-do-teste" onClick={onFechar} className="absolute inset-0 bg-slate-950/50" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="fixed inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:w-[440px] dark:bg-card"
      >
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <h2 id={tituloId} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <FlaskConical size={18} aria-hidden="true" className="text-brand-700 dark:text-brand-300" />
            Testar sem enviar
          </h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            Nada aqui vai para o WhatsApp. A conversa simulada não é gravada.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Número de referência
              <select value={numeroId} onChange={(e) => setNumeroId(e.target.value)} className={`${CAMPO} mt-1`}>
                {agente.numeros.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nome}
                  </option>
                ))}
                <option value="">Sem número (sem agenda)</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Nome do lead (opcional)
              <input
                value={nomeDoLead}
                maxLength={80}
                onChange={(e) => setNomeDoLead(e.target.value)}
                className={`${CAMPO} mt-1`}
              />
            </label>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-4 dark:bg-white/[0.02]">
          {turnos.length === 0 && !enviando ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Escreva a primeira mensagem como se fosse o lead.
            </p>
          ) : null}
          {turnos.map((t, i) =>
            t.tipo === 'lead' ? (
              <Balao key={i} autor="lead" texto={t.texto} />
            ) : (
              t.resultado.partes.map((parte, j) => <Balao key={`${i}-${j}`} autor="agente" texto={parte} />)
            ),
          )}
          {enviando ? (
            <div className="flex justify-end">
              <span role="status" className="inline-flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-2.5 text-xs text-slate-600">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Gerando a resposta...
              </span>
            </div>
          ) : null}

          {resposta ? (
            <section
              aria-label="O que o agente fez"
              className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-card dark:text-slate-200"
            >
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">O que o agente fez</h3>
              {itens.length > 0 ? (
                <ul className="space-y-1">
                  {itens.map((item) => (
                    <li key={item.rotulo}>
                      <span className="font-medium text-slate-900 dark:text-white">{`${item.rotulo}:`}</span>{' '}
                      <span className="whitespace-pre-wrap">{item.valor}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Só respondeu, sem outra ação.</p>
              )}
              <p className="text-slate-500 dark:text-slate-400">{linhaDoUso(resposta)}</p>
              <p className="text-slate-500 dark:text-slate-400">{linhaDaVersao(resposta)}</p>
              {resposta.numero?.referenciaHipotetica ? (
                <p className="text-amber-800 dark:text-amber-200">Referência hipotética: este número não responde por este agente.</p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                {resposta.retrato ? (
                  <button
                    type="button"
                    onClick={() => void explicar(resposta)}
                    disabled={explicacao?.estado === 'carregando'}
                    className={BOTAO}
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    Explicar esta resposta
                  </button>
                ) : null}
                <button type="button" onClick={recomecar} disabled={enviando} className={BOTAO}>
                  <RotateCcw size={13} aria-hidden="true" />
                  Recomeçar
                </button>
              </div>
              {explicacao?.estado === 'carregando' ? (
                <p role="status" className="inline-flex items-center gap-2 text-slate-500">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  Gerando a explicação...
                </p>
              ) : null}
              {explicacao?.estado === 'pronta' ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-white/10 dark:bg-white/5">
                  <p className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Explicação gerada depois da resposta. Ela não muda o que foi respondido.
                  </p>
                  <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-100">{explicacao.texto}</p>
                </div>
              ) : null}
              {explicacao?.estado === 'erro' ? (
                <p role="alert" className="text-rose-700 dark:text-rose-300">{explicacao.mensagem}</p>
              ) : null}
            </section>
          ) : null}
          <div ref={fim} />
        </div>

        <footer className="space-y-2 border-t border-slate-200 px-4 py-3 dark:border-white/10">
          {erro ? (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
            >
              <p>{erro.mensagem}</p>
              {erro.recarregar ? (
                <button
                  type="button"
                  onClick={() => {
                    setErro(null);
                    onMudou();
                  }}
                  className={BOTAO}
                >
                  Recarregar o agente
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <label htmlFor={campoId} className="sr-only">
              Mensagem do lead
            </label>
            <textarea
              id={campoId}
              ref={campo}
              value={texto}
              rows={2}
              maxLength={2000}
              disabled={enviando}
              placeholder="Escreva como o lead..."
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              className={`${CAMPO} resize-none`}
            />
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || !texto.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
              Enviar
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
