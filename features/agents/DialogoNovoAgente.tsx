'use client';

import React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { AgenteNaLista, InicioDoAgente, ModeloNaLista } from '@/lib/agents/tiposDoEditor';
import { ErroDaApi, agentesApi, type CursorDeClientes } from './agentesApi';
import { formatarDataHora } from './formatos';

type Comeco = 'modelo' | 'branco' | 'copia';
const PROIBIDOS = ['{', '}', '[', ']'];
const respostaInvalida = (v: string) => v.length > 500 || PROIBIDOS.some((c) => v.includes(c));

type ClienteDaLista = { id: string; name: string; created_at?: string };

/**
 * O nome do cliente não é único. A data de criação, sempre em Brasília (a tela Clientes mostra a mesma data no fuso
 * do navegador), e o começo do id (o mesmo da URL do cliente) separam homônimos na lista e na confirmação (revisão do
 * Codex, código, rodadas 3 e 4).
 */
function rotuloDoCliente(c: ClienteDaLista): string {
  const quando = c.created_at ? `criado em ${formatarDataHora(c.created_at)}, ` : '';
  return `${c.name} (${quando}id ${c.id.slice(0, 8)})`;
}

/**
 * Bloco 2: cria um agente neste cliente. Três começos: um modelo da agência (com uma resposta por lacuna), o padrão em
 * branco ou a cópia da versão publicada de outro agente. O agente nasce em rascunho; o texto de modelo e cópia é montado
 * no servidor, nunca enviado daqui.
 */
export function DialogoNovoAgente(props: {
  tenantId: string;
  clienteNome: string | null;
  onFechar: () => void;
  onCriado: (agenteId: string) => void;
}) {
  const { tenantId, clienteNome, onFechar, onCriado } = props;
  const [nome, setNome] = React.useState('');
  const [comeco, setComeco] = React.useState<Comeco>('branco');
  const [modelos, setModelos] = React.useState<ModeloNaLista[] | null>(null);
  const [modeloId, setModeloId] = React.useState<string | null>(null);
  const [respostas, setRespostas] = React.useState<Record<string, string>>({});
  const [clientes, setClientes] = React.useState<ClienteDaLista[] | null>(null);
  const [buscaCliente, setBuscaCliente] = React.useState('');
  const [proximaClientes, setProximaClientes] = React.useState<CursorDeClientes | null>(null);
  const [carregandoMais, setCarregandoMais] = React.useState(false);
  /** Muda a cada busca nova: um "mostrar mais" que chegar depois dela é descartado. */
  const geracaoDaBusca = React.useRef(0);
  const [origemId, setOrigemId] = React.useState<string | null>(null);
  const [agentesDaOrigem, setAgentesDaOrigem] = React.useState<AgenteNaLista[] | null>(null);
  const [agenteId, setAgenteId] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const carregarModelos = React.useCallback(async () => {
    try {
      const r = await agentesApi.modelos.listar();
      setModelos(r.modelos);
      if (r.modelos.length > 0) setComeco((atual) => (atual === 'branco' ? 'modelo' : atual));
    } catch (e) {
      setModelos([]);
      setErro(e instanceof Error ? e.message : 'Falha ao carregar os modelos.');
    }
  }, []);

  React.useEffect(() => {
    void carregarModelos();
  }, [carregarModelos]);

  // O servidor manda 100 clientes por página: a busca por nome e o "Mostrar mais clientes" alcançam os outros
  // (revisão do Codex no código, rodadas 1 e 2).
  React.useEffect(() => {
    if (comeco !== 'copia') return;
    let valido = true;
    // Busca nova: o cursor e o "carregando" da busca anterior deixam de valer (revisão do Codex, código, rodada 3).
    setProximaClientes(null);
    setCarregandoMais(false);
    const espera = setTimeout(() => {
      agentesApi
        .clientes(buscaCliente.trim())
        .then((r) => {
          if (!valido) return;
          const lista = r.tenants.map((t) => ({ id: t.id, name: t.name, created_at: t.created_at }));
          setClientes(lista);
          setProximaClientes(r.proxima ?? null);
          setOrigemId((atual) => (atual && lista.some((c) => c.id === atual) ? atual : null));
        })
        .catch((e) => valido && setErro(e instanceof Error ? e.message : 'Falha ao carregar os clientes.'));
    }, buscaCliente ? 300 : 0);
    return () => {
      valido = false;
      geracaoDaBusca.current += 1;
      clearTimeout(espera);
    };
  }, [comeco, buscaCliente]);

  const mostrarMaisClientes = async () => {
    if (!proximaClientes || carregandoMais) return;
    const geracao = geracaoDaBusca.current;
    setCarregandoMais(true);
    try {
      const r = await agentesApi.clientes(buscaCliente.trim(), proximaClientes);
      if (geracao !== geracaoDaBusca.current) return;
      setClientes((atual) => {
        const vistos = new Set((atual ?? []).map((c) => c.id));
        return [
          ...(atual ?? []),
          ...r.tenants.filter((t) => !vistos.has(t.id)).map((t) => ({ id: t.id, name: t.name, created_at: t.created_at })),
        ];
      });
      setProximaClientes(r.proxima ?? null);
    } catch (e) {
      if (geracao === geracaoDaBusca.current) setErro(e instanceof Error ? e.message : 'Falha ao carregar os clientes.');
    } finally {
      // Só a busca que pediu esta página pode encerrar o "carregando"; uma busca nova já o encerrou.
      if (geracao === geracaoDaBusca.current) setCarregandoMais(false);
    }
  };

  React.useEffect(() => {
    setAgentesDaOrigem(null);
    setAgenteId(null);
    if (!origemId) return;
    agentesApi
      .listar(origemId)
      .then((r) => setAgentesDaOrigem(r.agentes.filter((a) => a.publicada)))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Falha ao carregar os agentes.'));
  }, [origemId]);

  const modelo = modelos?.find((m) => m.id === modeloId) ?? null;
  const escolherModelo = (id: string) => {
    setModeloId(id);
    setRespostas({});
    const m = modelos?.find((x) => x.id === id);
    if (m && !nome.trim()) setNome(m.nome);
  };
  const agenteOrigem = agentesDaOrigem?.find((a) => a.id === agenteId) ?? null;
  const clienteOrigem = clientes?.find((c) => c.id === origemId) ?? null;
  const respostasRuins = Object.entries(respostas).filter(([, v]) => respostaInvalida(v)).map(([k]) => k);

  const inicio: InicioDoAgente | null =
    comeco === 'branco'
      ? { tipo: 'branco' }
      : comeco === 'modelo'
        ? modelo
          ? {
              tipo: 'modelo',
              modeloId: modelo.id,
              revisaoDoModelo: modelo.revisao,
              respostas: Object.fromEntries(Object.entries(respostas).filter(([, v]) => v.trim() !== '')),
            }
          : null
        : agenteOrigem?.publicada && origemId
          ? { tipo: 'copia', clienteDeOrigemId: origemId, agenteId: agenteOrigem.id, versaoEsperada: agenteOrigem.publicada.versao }
          : null;
  const podeCriar = !enviando && nome.trim().length > 0 && nome.trim().length <= 80 && inicio !== null && respostasRuins.length === 0;

  const criar = async () => {
    if (!inicio) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await agentesApi.criar(tenantId, { nome: nome.trim(), inicio });
      onCriado(r.agenteId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao criar o agente.');
      if (e instanceof ErroDaApi && e.status === 409 && comeco === 'modelo') {
        // O modelo mudou ou foi arquivado enquanto a tela estava aberta: recarrega para mostrar as lacunas de agora.
        setModeloId(null);
        setRespostas({});
        void carregarModelos();
      }
    } finally {
      setEnviando(false);
    }
  };

  const opcao = (valor: Comeco, rotulo: string, desabilitada = false) => (
    <label className={`flex items-center gap-2 text-sm ${desabilitada ? 'text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
      <input type="radio" name="comeco" value={valor} checked={comeco === valor} disabled={desabilitada} onChange={() => setComeco(valor)} />
      {rotulo}
    </label>
  );

  return (
    <Modal isOpen onClose={enviando ? () => undefined : onFechar} title="Novo agente" size="lg" bodyClassName="space-y-4">
      <div>
        <label htmlFor="nome-do-agente" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
          Nome do agente
        </label>
        <input
          id="nome-do-agente"
          value={nome}
          maxLength={80}
          onChange={(e) => setNome(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-white"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-800 dark:text-slate-100">Começar de</legend>
        {opcao('modelo', 'Modelo da agência', modelos !== null && modelos.length === 0)}
        {modelos !== null && modelos.length === 0 ? (
          <p className="ml-6 text-xs text-slate-500 dark:text-slate-400">Nenhum modelo ainda. Crie em Modelos de agente.</p>
        ) : null}
        {opcao('branco', 'Padrão em branco')}
        {opcao('copia', 'Copiar de outro agente')}
      </fieldset>

      {comeco === 'modelo' && modelos && modelos.length > 0 ? (
        <div className="space-y-3">
          <label htmlFor="modelo-escolhido" className="block text-sm font-medium text-slate-800 dark:text-slate-100">
            Modelo
          </label>
          <select
            id="modelo-escolhido"
            value={modeloId ?? ''}
            onChange={(e) => escolherModelo(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white"
          >
            <option value="" disabled>
              Escolha um modelo
            </option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
          {modelo?.descricao ? <p className="text-xs text-slate-600 dark:text-slate-300">{modelo.descricao}</p> : null}
          {modelo && modelo.lacunas.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                O que ficar em branco continua entre colchetes e a verificação do Publicar avisa.
              </p>
              {modelo.lacunas.map((lacuna) => {
                const ambigua = modelo.ambiguas.includes(lacuna);
                const valor = respostas[lacuna] ?? '';
                return (
                  <div key={lacuna}>
                    <label htmlFor={`lacuna-${lacuna}`} className="mb-1 block text-sm text-slate-800 dark:text-slate-100">
                      {lacuna}
                    </label>
                    <input
                      id={`lacuna-${lacuna}`}
                      value={valor}
                      disabled={ambigua}
                      maxLength={500}
                      onChange={(e) => setRespostas((atual) => ({ ...atual, [lacuna]: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white"
                    />
                    {ambigua ? (
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                        Esta lacuna também aparece como texto de um link no modelo. Ajuste o modelo para poder responder.
                      </p>
                    ) : respostaInvalida(valor) ? (
                      <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">A resposta não pode ter chaves nem colchetes.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {comeco === 'copia' ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="busca-de-cliente" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
              Buscar cliente
            </label>
            <input
              id="busca-de-cliente"
              value={buscaCliente}
              maxLength={80}
              onChange={(e) => setBuscaCliente(e.target.value)}
              placeholder="Parte do nome do cliente"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-white"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">A lista vem do cliente mais recente ao mais antigo, 100 por vez.</p>
          </div>
          <div>
            <label htmlFor="cliente-de-origem" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
              Cliente de origem
            </label>
            <select
              id="cliente-de-origem"
              value={origemId ?? ''}
              onChange={(e) => setOrigemId(e.target.value || null)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white"
            >
              <option value="">{clientes ? 'Escolha o cliente' : 'Carregando...'}</option>
              {(clientes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {rotuloDoCliente(c)}
                </option>
              ))}
            </select>
            {proximaClientes ? (
              <button
                type="button"
                onClick={() => void mostrarMaisClientes()}
                disabled={carregandoMais}
                className="mt-2 text-sm font-medium text-brand-700 underline-offset-2 hover:underline disabled:opacity-60 dark:text-brand-300"
              >
                {carregandoMais ? 'Carregando mais clientes...' : 'Mostrar mais clientes'}
              </button>
            ) : null}
          </div>
          {origemId ? (
            <div>
              <label htmlFor="agente-de-origem" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
                Agente
              </label>
              <select
                id="agente-de-origem"
                value={agenteId ?? ''}
                onChange={(e) => setAgenteId(e.target.value || null)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white"
              >
                <option value="">
                  {agentesDaOrigem === null ? 'Carregando...' : agentesDaOrigem.length === 0 ? 'Nenhum agente publicado neste cliente' : 'Escolha o agente'}
                </option>
                {(agentesDaOrigem ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {agenteOrigem?.publicada && clienteOrigem ? (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Copiar a versão {agenteOrigem.publicada.versao} de {agenteOrigem.nome}, do cliente {rotuloDoCliente(clienteOrigem)}, para o cliente{' '}
              {clienteNome ?? 'atual'}.
            </p>
          ) : null}
        </div>
      ) : null}

      {comeco === 'branco' ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Começa com o texto neutro de 8 seções que os números sem agente já usam. Depois você edita, testa sem enviar e publica.
        </p>
      ) : null}

      {erro ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {erro}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          disabled={enviando}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 dark:border-white/10 dark:text-slate-200"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void criar()}
          disabled={!podeCriar}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          Criar
        </button>
      </div>
    </Modal>
  );
}
