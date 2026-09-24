'use client';

/**
 * Conversões para a Meta (CAPI) — configuração por organização, dentro de Conexões.
 *
 * Até 23/09/2026 não existia tela nenhuma: tudo era feito por script. Pior, o token era o único
 * campo que NINGUÉM conseguia salvar (erro de GRANT por coluna, consertado no mesmo dia).
 *
 * Os avisos desta tela não são decoração. Cada um corresponde a uma armadilha que já custou
 * horas de diagnóstico, e todas falham em SILÊNCIO — a conversão simplesmente não chega:
 *
 *  - dataset de SITE recusa evento de conversa (subcódigo 2804132) e vice-versa (2804131);
 *  - `test_event_code` preenchido manda tudo para a aba de teste: não conta como conversão;
 *  - lista de DDDs mal preenchida faz o marco nascer `skipped` com motivo `fora_da_regiao`;
 *  - marco mapeado como "não enviar" some sem deixar rastro na Meta.
 */

import React from 'react';
import { Check, ChevronDown, Loader2, Send, TriangleAlert } from 'lucide-react';
import { FIELD_CLASS } from './conversations/calendarSettingsForm';

type EventType = 'replied' | 'scheduled' | 'attended' | 'won';

type CapiSettings = {
  enabled: boolean;
  datasetId: string;
  whatsappBusinessAccountId: string;
  hasToken: boolean;
  tokenLast4: string;
  testEventCode: string;
  sendValue: boolean;
  eventMap: Record<string, string | null>;
  regionDdds: string[];
  supportedEventNames: string[];
  eventNameLabels: Record<string, string>;
  eventTypeLabels: Record<string, string>;
};

const ORDEM_DOS_MARCOS: EventType[] = ['replied', 'scheduled', 'attended', 'won'];

const ROTULO = 'text-xs font-semibold text-slate-600 dark:text-slate-300';

/** Só dígitos, em pares, sem repetir — o formato que a função do banco espera. */
function lerDdds(texto: string) {
  const vistos = new Set<string>();
  for (const parte of texto.split(/[^0-9]+/)) {
    if (/^\d{2}$/.test(parte)) vistos.add(parte);
  }
  return [...vistos];
}

function Aviso({ children, tom = 'atencao' }: { children: React.ReactNode; tom?: 'atencao' | 'perigo' }) {
  const cores = tom === 'perigo'
    ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100'
    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
  return (
    <p className={`mt-2 flex gap-2 rounded-xl border px-3 py-2 text-xs ${cores}`}>
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function MetaCapiSettings({ disabled }: { disabled: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const [dados, setDados] = React.useState<CapiSettings | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [mensagem, setMensagem] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState(false);

  // Token novo digitado agora. Vive só aqui: o valor gravado NUNCA volta do servidor.
  const [tokenNovo, setTokenNovo] = React.useState('');
  const [dddsTexto, setDddsTexto] = React.useState('');

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(false);
    try {
      const res = await fetch('/api/settings/meta-capi', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(corpo?.error || `HTTP ${res.status}`);
      setDados(corpo as CapiSettings);
      setDddsTexto((corpo.regionDdds ?? []).join(', '));
      setTokenNovo('');
    } catch (e) {
      setErro(true);
      setMensagem(e instanceof Error ? e.message : 'Falha ao carregar a configuração.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // Só busca quando o painel abre: nada de rede sem o usuário pedir.
  React.useEffect(() => {
    if (expanded && !dados && !carregando) void carregar();
  }, [carregar, carregando, dados, expanded]);

  function mexer(campo: keyof CapiSettings, valor: unknown) {
    setDados(atual => (atual ? { ...atual, [campo]: valor } as CapiSettings : atual));
  }

  async function salvar() {
    if (!dados) return;
    setMensagem(null);
    setErro(false);

    const ddds = lerDdds(dddsTexto);
    const corpo: Record<string, unknown> = {
      enabled: dados.enabled,
      datasetId: dados.datasetId.trim(),
      whatsappBusinessAccountId: dados.whatsappBusinessAccountId.trim(),
      testEventCode: dados.testEventCode.trim(),
      sendValue: dados.sendValue,
      eventMap: Object.fromEntries(ORDEM_DOS_MARCOS.map(t => [t, dados.eventMap[t] ?? null])),
      regionDdds: ddds,
    };
    // Campo em branco não apaga o token guardado: só manda quando a pessoa digitou algo.
    if (tokenNovo.trim()) corpo.accessToken = tokenNovo.trim();

    setSalvando(true);
    try {
      const res = await fetch('/api/settings/meta-capi', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(corpo),
      });
      const resposta = await res.json().catch(() => null);
      if (!res.ok) throw new Error(resposta?.error || `HTTP ${res.status}`);
      setMensagem('Configuração salva.');
      setDados(null);          // força releitura: o que vale é o que o servidor devolve
      await carregar();
    } catch (e) {
      setErro(true);
      setMensagem(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  const travado = disabled || salvando || carregando;
  const resumo = !dados
    ? 'Toque para carregar'
    : dados.enabled
      ? (dados.testEventCode ? 'Ligado, mas em MODO DE TESTE' : 'Enviando conversões')
      : 'Desligado';

  return (
    <section className="mt-3 rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-card">
      <button
        type="button"
        onClick={() => setExpanded(atual => !atual)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <Send className="h-4 w-4 text-cyan-500" aria-hidden="true" />
          <span>
            <span className="block text-sm font-semibold text-slate-900 dark:text-white">Conversões para a Meta</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {resumo} · avisa a Meta quem virou lead, reunião e venda
            </span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded ? (
        <div className="border-t border-slate-200 p-4 dark:border-white/10">
          {carregando && !dados ? (
            <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </p>
          ) : null}

          {dados ? (
            <>
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                Enviar conversões para a Meta
                <input
                  type="checkbox"
                  checked={dados.enabled}
                  disabled={travado}
                  onChange={e => mexer('enabled', e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
                />
              </label>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Desligado, os marcos continuam sendo registrados no CRM; só não vão para a Meta.
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className={`${ROTULO} md:col-span-2`}>
                  Conjunto de dados (dataset)
                  <input
                    className={`${FIELD_CLASS} mt-1`}
                    value={dados.datasetId}
                    disabled={travado}
                    onChange={e => mexer('datasetId', e.target.value)}
                    placeholder="ex.: 1111045858153415"
                  />
                </label>
                <div className="md:col-span-2 -mt-2">
                  <Aviso>
                    Precisa ser o conjunto de dados <strong>da conta de WhatsApp</strong>, não o pixel do
                    site. Pixel de site recusa evento de conversa, e a Meta devolve só &quot;parâmetro
                    inválido&quot; — a conversão some sem aviso.
                  </Aviso>
                </div>

                <label className={`${ROTULO} md:col-span-2`}>
                  ID da conta de WhatsApp Business
                  <input
                    className={`${FIELD_CLASS} mt-1`}
                    value={dados.whatsappBusinessAccountId}
                    disabled={travado}
                    onChange={e => mexer('whatsappBusinessAccountId', e.target.value)}
                    placeholder="ex.: 2620648758307353"
                  />
                  <span className="mt-1 block font-normal text-slate-500 dark:text-slate-400">
                    Vai junto de cada evento. Sem ele a Meta recusa tudo.
                  </span>
                </label>

                <label className={`${ROTULO} md:col-span-2`}>
                  Token de acesso
                  <input
                    className={`${FIELD_CLASS} mt-1`}
                    type="password"
                    autoComplete="off"
                    value={tokenNovo}
                    disabled={travado}
                    onChange={e => setTokenNovo(e.target.value)}
                    placeholder={dados.hasToken ? 'Deixe em branco para manter o atual' : 'Cole o token aqui'}
                  />
                  <span className="mt-1 block font-normal text-slate-500 dark:text-slate-400">
                    {dados.hasToken
                      ? <>Configurado · termina em <span className="font-mono">••••{dados.tokenLast4}</span>. O token nunca volta para a tela; digite um novo só para substituir.</>
                      : 'Nenhum token guardado ainda.'}
                  </span>
                </label>
              </div>

              <div className="mt-5">
                <p className={ROTULO}>O que avisar à Meta em cada etapa</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  À esquerda, o que aconteceu no CRM. À direita, o nome que a Meta entende.
                </p>
                <div className="mt-2 grid gap-3">
                  {ORDEM_DOS_MARCOS.map(tipo => (
                    <label key={tipo} className="grid gap-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-[1fr_1fr] sm:items-center sm:gap-3">
                      <span className="font-semibold">{dados.eventTypeLabels[tipo] ?? tipo}</span>
                      <select
                        className={FIELD_CLASS}
                        value={dados.eventMap[tipo] ?? ''}
                        disabled={travado}
                        onChange={e => mexer('eventMap', { ...dados.eventMap, [tipo]: e.target.value || null })}
                      >
                        <option value="">Não enviar esta etapa</option>
                        {dados.supportedEventNames.map(nome => (
                          <option key={nome} value={nome}>{dados.eventNameLabels[nome] ?? nome}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <label className="mt-5 flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                Mandar também o valor da venda
                <input
                  type="checkbox"
                  checked={dados.sendValue}
                  disabled={travado}
                  onChange={e => mexer('sendValue', e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
                />
              </label>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Com o valor, a Meta busca faturamento; sem ele, busca quantidade de vendas. Só funciona
                se alguém preencher o valor do negócio ao marcar como ganho.
              </p>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className={ROTULO}>
                  DDDs da sua região
                  <input
                    className={`${FIELD_CLASS} mt-1`}
                    value={dddsTexto}
                    disabled={travado}
                    onChange={e => setDddsTexto(e.target.value)}
                    placeholder="vazio = Brasil inteiro"
                  />
                  <span className="mt-1 block font-normal text-slate-500 dark:text-slate-400">
                    Deixe vazio se atende o país todo. Preenchido, só lead desses DDDs conta como
                    &quot;respondeu&quot; — os outros ficam registrados no CRM e não vão para a Meta.
                  </span>
                </label>

                <label className={ROTULO}>
                  Código de teste (opcional)
                  <input
                    className={`${FIELD_CLASS} mt-1`}
                    value={dados.testEventCode}
                    disabled={travado}
                    onChange={e => mexer('testEventCode', e.target.value)}
                    placeholder="deixe vazio em produção"
                  />
                </label>
                {dados.testEventCode.trim() ? (
                  <div className="md:col-span-2 -mt-2">
                    <Aviso tom="perigo">
                      Com código de teste preenchido, <strong>nenhuma conversão conta</strong>: tudo vai
                      para a aba &quot;Testar eventos&quot; da Meta. Apague quando terminar de testar.
                    </Aviso>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className={`text-xs ${erro ? 'text-rose-500' : 'text-emerald-500'}`} role="status">{mensagem}</p>
                <button
                  type="button"
                  onClick={() => void salvar()}
                  disabled={travado}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-white transition hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50"
                >
                  {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar conversões
                </button>
              </div>
            </>
          ) : null}

          {!dados && !carregando && mensagem ? (
            <p className="text-xs text-rose-500" role="status">{mensagem}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
