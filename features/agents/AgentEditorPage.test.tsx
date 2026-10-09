import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';

const estado = vi.hoisted(() => ({ role: 'agency_admin' as string }));
const toast = vi.hoisted(() => vi.fn());
const navegar = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navegar, replace: navegar }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: estado.role }, loading: false }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast, showToast: toast }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

import { AgentEditorPage } from './AgentEditorPage';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE_ID = '22222222-2222-4222-8222-222222222222';
const URL_AGENTE = `/api/platform/tenants/${TENANT}/agents/${AGENTE_ID}`;
const PUBLICADO = 'Voce e a Aurora.\nREGRAS:\n- fale com {{contactName}}\n{{conversationStageContext}}\n- replyText: resposta curta';

function agente(extra: Partial<AgenteNoEditor> = {}): AgenteNoEditor {
  return {
    id: AGENTE_ID,
    nome: 'Aurora',
    cliente: { id: TENANT, nome: 'Cenno Hub' },
    publicada: {
      id: 'v1', versao: 1, origem: 'migration', restauradaDe: null, nota: null, publicadaEm: '2026-10-07T04:51:00Z',
      publicadaPor: null, prompt: PUBLICADO, ajustes: {}, modelo: null,
    },
    rascunho: { prompt: null, revisao: 0, atualizadoEm: null, atualizadoPor: null },
    numeros: [{ id: 'n1', nome: 'Comercial', temAgenda: false }],
    ...extra,
  };
}

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

/** fetch falso por "MÉTODO url"; pedido fora da lista quebra o teste. */
function fetchFalso(rotas: Record<string, (init?: RequestInit) => Promise<Response>>) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(url)}`;
    const rota = rotas[chave];
    if (!rota) throw new Error(`fetch inesperado: ${chave}`);
    return rota(init);
  });
}

const PREFIXO = `central-agentes:texto-nao-salvo:${TENANT}:${AGENTE_ID}:`;
/** As cópias locais deste agente, de qualquer instância do editor. */
function copiasDoAgente(): Array<{ texto: string; revisao: number }> {
  const copias: Array<{ texto: string; revisao: number }> = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const chave = localStorage.key(i);
    if (chave?.startsWith(PREFIXO)) copias.push(JSON.parse(localStorage.getItem(chave) ?? '{}'));
  }
  return copias;
}

/** Um instante relativo ao relógio, nunca uma data cravada: a validade das cópias é de 7 dias. */
const ha = (ms: number) => new Date(Date.now() - ms).toISOString();
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/**
 * Envelhece tudo o que o editor gravou no armazenamento (a cópia e, no editor de ca65a4b, também o sinal de vida): é o
 * que acontece com uma aba em segundo plano cujo relógio o navegador suspendeu.
 */
function envelhecer(ms: number) {
  const chaves: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const chave = localStorage.key(i);
    if (chave?.startsWith('central-agentes:')) chaves.push(chave);
  }
  for (const chave of chaves) {
    localStorage.setItem(chave, JSON.stringify({ ...JSON.parse(localStorage.getItem(chave) ?? '{}'), em: ha(ms) }));
  }
}

const corpoDe = (fetchMock: ReturnType<typeof fetchFalso>, sufixo: string) => {
  const chamada = fetchMock.mock.calls.find(([url]) => String(url).endsWith(sufixo));
  return JSON.parse(String(chamada?.[1]?.body));
};

beforeEach(() => {
  estado.role = 'agency_admin';
  toast.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('AgentEditorPage', () => {
  it('quem não é da agência vê acesso restrito e nada é pedido', () => {
    estado.role = 'agency_staff';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mostra a versão publicada e a leitura por seções, com a variável como etiqueta', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);

    expect(await screen.findByText('Versão 1 publicada em 07/10/2026 às 01:51 pela migração')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'REGRAS' })).toBeInTheDocument();
    expect(screen.getByText('{{contactName}}')).toBeInTheDocument();
    expect(screen.getByText('Sem mudanças no rascunho')).toBeInTheDocument();
    expect(screen.getByText('Nenhum erro nem aviso.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Testar sem enviar/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Comportamento/ })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Central de Agentes' })).toHaveAttribute('href', `/platform/tenants/${TENANT}/agents`);
  });

  it('testar sem enviar: abre o painel; em edição o botão fica desabilitado com o motivo', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: /Testar sem enviar/ }));
    const painel = screen.getByRole('dialog', { name: 'Testar sem enviar' });
    expect(within(painel).getByText('Nada aqui vai para o WhatsApp. A conversa simulada não é gravada.')).toBeInTheDocument();
    fireEvent.click(within(painel).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog', { name: 'Testar sem enviar' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const testar = screen.getByRole('button', { name: /Testar sem enviar/ });
    expect(testar).toBeDisabled();
    expect(testar).toHaveAttribute('title', 'Salve ou cancele a edição antes de testar.');
  });

  it('editar: a verificação acusa a variável desconhecida a cada tecla e salvar manda a revisão lida', async () => {
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }),
      [`PUT ${URL_AGENTE}/draft`]: () => responder({ revisao: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const campo = screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement;
    expect(campo.value).toBe(PUBLICADO);
    fireEvent.change(campo, { target: { value: `${PUBLICADO}\n{{nomeDoLead}}` } });
    expect(screen.getByText(/\{\{nomeDoLead\}\} não é uma das 12 variáveis/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Rascunho salvo.', 'success'));
    expect(corpoDe(fetchMock, '/draft')).toEqual({ prompt: `${PUBLICADO}\n{{nomeDoLead}}`, revisao: 0 });
  });

  it('salvar com a revisão velha (outra aba salvou antes): avisa, mantém o texto e deixa a escolha explícita', async () => {
    const MENSAGEM = 'O rascunho foi alterado em outra aba ou por outra pessoa enquanto você editava.';
    const daOutraAba = agente({
      rascunho: { prompt: `${PUBLICADO}\ntexto da outra aba`, revisao: 1, atualizadoEm: '2026-10-07T12:00:00Z', atualizadoPor: 'Junior' },
    });
    let leituras = 0;
    let gravacoes = 0;
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => {
        leituras += 1;
        return responder({ agente: leituras === 1 ? agente() : daOutraAba });
      },
      [`PUT ${URL_AGENTE}/draft`]: () => {
        gravacoes += 1;
        return gravacoes === 1 ? responder({ error: MENSAGEM, code: 'RASCUNHO_MUDOU' }, 409) : responder({ revisao: 2 });
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const meu = `${PUBLICADO}\nmeu texto`;
    fireEvent.change(screen.getByLabelText('Prompt do agente'), { target: { value: meu } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(MENSAGEM, 'error'));
    await waitFor(() => expect(leituras).toBe(2));
    // O texto de quem editava continua no campo; o salvar comum fica travado até a escolha (revisão do Codex, 07/10).
    expect((screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(meu);
    expect(screen.getByText(/O seu texto continua aqui, sem salvar\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar o meu por cima' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Rascunho salvo.', 'success'));
    const corpos = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/draft'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(corpos).toEqual([{ prompt: meu, revisao: 0 }, { prompt: meu, revisao: 1 }]);
  });

  it('texto não salvo sobrevive a sair pela navegação interna: a cópia local oferece recuperar', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    const primeira = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Prompt do agente'), { target: { value: `${PUBLICADO}\nnão salvei` } });
    expect(copiasDoAgente()).toEqual([expect.objectContaining({ texto: `${PUBLICADO}\nnão salvei`, revisao: 0 })]);

    // Saiu por um link interno (o editor desmonta sem passar pelo beforeunload) e voltou depois.
    primeira.unmount();
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(await screen.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar o texto' }));
    expect((screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(`${PUBLICADO}\nnão salvei`);
    // Ninguém salvou no meio (mesma revisão): sem conflito.
    expect(screen.queryByText(/O seu texto continua aqui/)).not.toBeInTheDocument();

    // Cancelar apaga só a cópia DESTE editor. A do editor anterior fica guardada: esta aba nunca apaga a cópia de outra
    // instância (rodada 4). O happy-dom não implementa window.confirm: stub, como em
    // features/atendimentos/hooks/useAtendimentosController.test.tsx (o afterEach desfaz).
    const confirmar = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirmar);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([`${PUBLICADO}\nnão salvei`]);
  });

  it('recuperar um texto escrito antes de outra pessoa salvar cai no conflito: sobrescrever só com a escolha explícita', async () => {
    // Revisão do Codex, rodada 2, achado 1: a cópia guarda a revisão em que o texto se baseou.
    const ANTIGO = `${PUBLICADO}\ntexto de antes`;
    localStorage.setItem(`${PREFIXO}aba-que-fechou`, JSON.stringify({ texto: ANTIGO, revisao: 0, em: ha(HORA) }));
    const depois = agente({
      rascunho: { prompt: `${PUBLICADO}\nsalvo por outra pessoa`, revisao: 1, atualizadoEm: '2026-10-07T11:00:00Z', atualizadoPor: 'Junior' },
    });
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: depois }),
      [`PUT ${URL_AGENTE}/draft`]: () => responder({ revisao: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(await screen.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar o texto' }));

    expect((screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(ANTIGO);
    expect(
      screen.getByText(/O rascunho foi alterado depois que este texto foi escrito\. O seu texto continua aqui, sem salvar\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar o meu por cima' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Rascunho salvo.', 'success'));
    expect(corpoDe(fetchMock, '/draft')).toEqual({ prompt: ANTIGO, revisao: 1 });
  });

  it('salvar nesta aba não apaga a cópia de outra aba com texto não salvo do mesmo agente', async () => {
    // Revisão do Codex, rodada 2, achado 2: a chave da cópia leva a instância do editor.
    const DA_OUTRA_ABA = `${PUBLICADO}\ntexto da outra aba`;
    localStorage.setItem(`${PREFIXO}outra-aba`, JSON.stringify({ texto: DA_OUTRA_ABA, revisao: 0, em: ha(HORA) }));
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }),
      [`PUT ${URL_AGENTE}/draft`]: () => responder({ revisao: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Prompt do agente'), { target: { value: `${PUBLICADO}\ntexto desta aba` } });
    expect(copiasDoAgente()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Rascunho salvo.', 'success'));

    expect(copiasDoAgente().map((c) => c.texto)).toEqual([DA_OUTRA_ABA]);
  });

  // Revisão do Codex, rodadas 3 e 4, achado 2: recuperar ou descartar a cópia de OUTRA aba nunca a apaga. A dona pode
  // estar aberta com o relógio suspenso pelo navegador (em segundo plano) e sair depois pela navegação interna sem
  // digitar de novo; a cópia é o que salva o texto dela. Os dois testes abaixo envelhecem o que a aba A gravou.
  it('duas abas abertas, a A parada há 2 h: recuperar na B não apaga a cópia da A, nem depois de cancelar na B', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    const DA_ABA_A = `${PUBLICADO}\ntexto da aba A`;
    const abaA = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    const a = within(abaA.container);
    await a.findByText(/Versão 1 publicada/);
    fireEvent.click(a.getByRole('button', { name: 'Editar' }));
    fireEvent.change(a.getByLabelText('Prompt do agente'), { target: { value: DA_ABA_A } });
    envelhecer(2 * HORA);

    const abaB = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    const b = within(abaB.container);
    expect(await b.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
    fireEvent.click(b.getByRole('button', { name: 'Recuperar o texto' }));
    expect((b.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(DA_ABA_A);
    // A cópia da aba A continua; a B ganhou a sua (o texto dela também não está salvo).
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([DA_ABA_A, DA_ABA_A]);

    // A B desiste: sai só a cópia dela.
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    fireEvent.click(b.getByRole('button', { name: 'Cancelar' }));
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([DA_ABA_A]);

    // A aba A sai pela navegação interna sem digitar de novo: a cópia dela não sumiu.
    abaA.unmount();
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([DA_ABA_A]);
  });

  it('duas abas abertas, a A parada há 2 h: descartar na B só esconde a cópia na B; a A não perde nada', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    const DA_ABA_A = `${PUBLICADO}\ntexto da aba A`;
    const abaA = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    const a = within(abaA.container);
    await a.findByText(/Versão 1 publicada/);
    fireEvent.click(a.getByRole('button', { name: 'Editar' }));
    fireEvent.change(a.getByLabelText('Prompt do agente'), { target: { value: DA_ABA_A } });
    envelhecer(2 * HORA);

    const abaB = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    const b = within(abaB.container);
    expect(await b.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
    fireEvent.click(b.getByRole('button', { name: 'Descartar' }));
    expect(b.queryByText(/Você tem um texto não salvo deste agente/)).not.toBeInTheDocument();
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([DA_ABA_A]);

    abaA.unmount();
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([DA_ABA_A]);
  });

  it('descartar uma cópia que ninguém mais tem aberta só a esconde nesta aba: não volta aqui, e aparece numa aba nova', async () => {
    const ORFA = `${PUBLICADO}\nórfã`;
    localStorage.setItem(`${PREFIXO}aba-que-fechou`, JSON.stringify({ texto: ORFA, revisao: 0, em: ha(HORA) }));
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    const primeira = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(await screen.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByText(/Você tem um texto não salvo deste agente/)).not.toBeInTheDocument();
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([ORFA]);

    // Sair do agente e voltar, na MESMA aba (o armazenamento da aba continua): ela segue escondida.
    primeira.unmount();
    const segunda = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    expect(screen.queryByText(/Você tem um texto não salvo deste agente/)).not.toBeInTheDocument();

    // Numa aba nova (armazenamento da aba vazio), ela aparece de novo.
    segunda.unmount();
    sessionStorage.clear();
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(await screen.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
  });

  it('cópia sem escrita há mais de 7 dias sai na procura; a de 6 dias ainda é oferecida', async () => {
    const RECENTE = `${PUBLICADO}\nde 6 dias`;
    localStorage.setItem(`${PREFIXO}velha`, JSON.stringify({ texto: `${PUBLICADO}\nde 8 dias`, revisao: 0, em: ha(8 * DIA) }));
    localStorage.setItem(`${PREFIXO}recente`, JSON.stringify({ texto: RECENTE, revisao: 0, em: ha(6 * DIA) }));
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(await screen.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
    expect(copiasDoAgente().map((c) => c.texto)).toEqual([RECENTE]);
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar o texto' }));
    expect((screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(RECENTE);
  });

  it('a validade não tira o texto de uma aba aberta: removida a cópia por outra aba, ela volta quando a aba fica visível', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    const DA_ABA_A = `${PUBLICADO}\ntexto da aba A`;
    const abaA = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    const a = within(abaA.container);
    await a.findByText(/Versão 1 publicada/);
    fireEvent.click(a.getByRole('button', { name: 'Editar' }));
    fireEvent.change(a.getByLabelText('Prompt do agente'), { target: { value: DA_ABA_A } });
    envelhecer(8 * DIA);

    // A aba B abre o agente e remove a cópia vencida da A.
    const abaB = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    const b = within(abaB.container);
    await b.findByText(/Versão 1 publicada/);
    expect(b.queryByText(/Você tem um texto não salvo deste agente/)).not.toBeInTheDocument();
    expect(copiasDoAgente()).toEqual([]);

    // A aba A volta a ficar visível: a cópia dela volta antes de dar para sair dali, e sobrevive à saída.
    fireEvent(document, new Event('visibilitychange'));
    expect(copiasDoAgente()).toEqual([expect.objectContaining({ texto: DA_ABA_A, revisao: 0 })]);
    abaA.unmount();
    expect(copiasDoAgente()).toEqual([expect.objectContaining({ texto: DA_ABA_A, revisao: 0 })]);
  });

  it('publicar com aviso exige a confirmação e manda a versão, a revisão e os avisos confirmados', async () => {
    const semNome = 'Voce e a Aurora.\nREGRAS:\n- fale\n{{conversationStageContext}}\n- replyText: resposta curta';
    const comRascunho = agente({
      rascunho: { prompt: semNome, revisao: 1, atualizadoEm: '2026-10-07T12:00:00Z', atualizadoPor: 'Junior' },
    });
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: comRascunho }),
      [`POST ${URL_AGENTE}/publish`]: () => responder({ versao: 2, versaoId: 'v2' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);

    expect(await screen.findByText('Rascunho com mudanças')).toBeInTheDocument();
    expect(screen.getByText('salvo em 07/10/2026 às 09:00 por Junior')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));

    const botao = await screen.findByRole('button', { name: 'Publicar versão 2' });
    expect(botao).toBeDisabled();
    expect(screen.getAllByText(/O rascunho tirou \{\{contactName\}\}/).length).toBeGreaterThan(0);
    expect(screen.getByText(/As respostas do número Comercial que começarem depois da publicação já saem com esta versão/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Li os avisos e quero publicar assim.'));
    fireEvent.change(screen.getByLabelText('Nota da versão (opcional)'), { target: { value: 'tirei o nome' } });
    expect(botao).toBeEnabled();
    fireEvent.click(botao);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Versão 2 publicada. As respostas que começarem a partir de agora já saem com ela.', 'success'),
    );
    expect(corpoDe(fetchMock, '/publish')).toEqual({ versaoEsperada: 1, revisao: 1, nota: 'tirei o nome', confirmarAvisos: ['perdeu:contactName'] });
  });

  it('publicar quando outra pessoa publicou antes (409): avisa, fecha o diálogo e recarrega (SPEC, fatia 2)', async () => {
    const MENSAGEM = 'Outra versão foi publicada enquanto você editava. A tela foi atualizada com a versão atual.';
    const comRascunho = agente({
      rascunho: { prompt: `${PUBLICADO}\nmais uma regra`, revisao: 1, atualizadoEm: '2026-10-07T12:00:00Z', atualizadoPor: 'Junior' },
    });
    let leituras = 0;
    vi.stubGlobal('fetch', fetchFalso({
      [`GET ${URL_AGENTE}`]: () => {
        leituras += 1;
        return responder({ agente: comRascunho });
      },
      [`POST ${URL_AGENTE}/publish`]: () => responder({ error: MENSAGEM, code: 'VERSAO_PUBLICADA_MUDOU' }, 409),
    }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText('Rascunho com mudanças');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    // Sem aviso no rascunho: o botão do diálogo já vem habilitado.
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar versão 2' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(MENSAGEM, 'error'));
    await waitFor(() => expect(leituras).toBe(2));
    expect(screen.queryByRole('button', { name: 'Publicar versão 2' })).toBeNull();
  });

  it('a aba Versões abre o histórico do agente; durante a edição ela fica bloqueada', async () => {
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }),
      [`GET ${URL_AGENTE}/versions`]: () => responder({ versoes: [], temMais: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByRole('tab', { name: 'Versões' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Versões' }));
    expect(await screen.findByRole('heading', { name: 'Versões' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${URL_AGENTE}/versions`, expect.objectContaining({ credentials: 'include' }));
  });
});

describe('AgentEditorPage: Salvar como modelo (bloco 2)', () => {
  it('só aparece com versão publicada; cria o modelo a partir dela e abre o editor do modelo', async () => {
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }),
      'POST /api/platform/agency/agent-templates': () => responder({ id: 'modelo-novo' }, 201),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: /Salvar como modelo/ }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText('Nome do modelo'), { target: { value: 'SDR de loja' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: /Criar modelo/ }));
    await waitFor(() => expect(navegar).toHaveBeenCalledWith('/platform/agent-templates/modelo-novo'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      nome: 'SDR de loja',
      deAgente: { tenantId: TENANT, agenteId: AGENTE_ID, versaoEsperada: 1 },
    });
  });

  it('sem versão publicada o botão não aparece', async () => {
    vi.stubGlobal('fetch', fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente({ publicada: null, rascunho: { prompt: 'Oi', revisao: 1, atualizadoEm: null, atualizadoPor: null } }) }),
    }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(await screen.findByRole('heading', { name: 'Aurora' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salvar como modelo/ })).toBeNull();
  });
});

describe('AgentEditorPage: renomear e excluir (SPEC-renomear-excluir.md)', () => {
  it('renomear: manda o nome aparado, avisa e o cabeçalho troca depois de recarregar', async () => {
    let leituras = 0;
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => {
        leituras += 1;
        return responder({ agente: agente(leituras > 1 ? { nome: 'Aurora 2' } : {}) });
      },
      [`POST ${URL_AGENTE}/rename`]: () => responder({ nome: 'Aurora 2' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    fireEvent.click(screen.getByRole('button', { name: 'Renomear agente' }));
    const dialogo = screen.getByRole('dialog', { name: 'Renomear agente' });
    fireEvent.change(within(dialogo).getByLabelText('Nome do agente'), { target: { value: '  Aurora 2 ' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar nome' }));
    expect(await screen.findByRole('heading', { name: 'Aurora 2' })).toBeInTheDocument();
    expect(corpoDe(fetchMock, '/rename')).toEqual({ nome: 'Aurora 2' });
    expect(toast).toHaveBeenCalledWith('Nome salvo.', 'success');
    expect(screen.queryByRole('dialog', { name: 'Renomear agente' })).not.toBeInTheDocument();
  });

  it('excluir com número ligado: mostra o bloqueio, sem botão de excluir, e nenhum pedido sai', async () => {
    const fetchMock = fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    const dialogo = screen.getByRole('dialog', { name: 'Excluir agente' });
    expect(within(dialogo).getByText('Este agente atende 1 número: Comercial. Desligue o número antes de excluir.')).toBeInTheDocument();
    expect(within(dialogo).queryByRole('button', { name: 'Excluir de vez' })).toBeNull();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Fechar' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('excluir sem número: manda o estado que a tela mostrou, avisa e volta para a lista', async () => {
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente({ numeros: [], rascunho: { prompt: 'novo', revisao: 4, atualizadoEm: null, atualizadoPor: null } }) }),
      [`POST ${URL_AGENTE}/delete`]: () => responder({ excluido: true, versoesExcluidas: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    const dialogo = screen.getByRole('dialog', { name: 'Excluir agente' });
    expect(within(dialogo).getByText(
      'Excluir o agente Aurora? Somem o agente, o rascunho e todas as versões publicadas. As conversas e o histórico de respostas continuam. Não dá para desfazer.',
    )).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir de vez' }));
    await waitFor(() => expect(navegar).toHaveBeenCalledWith(`/platform/tenants/${TENANT}/agents`));
    expect(corpoDe(fetchMock, '/delete')).toEqual({ nomeEsperado: 'Aurora', revisaoEsperada: 4, versaoPublicadaEsperada: 'v1' });
    expect(toast).toHaveBeenCalledWith('Agente excluído.', 'success');
  });

  it('409 AGENTE_MUDOU: a mensagem aparece, o agente é recarregado no diálogo e nada navega', async () => {
    navegar.mockClear();
    let leituras = 0;
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => {
        leituras += 1;
        return responder({ agente: agente({ numeros: [], ...(leituras > 1 ? { nome: 'Aurora renomeada' } : {}) }) });
      },
      [`POST ${URL_AGENTE}/delete`]: () => responder({
        error: 'O agente mudou desde que você abriu esta confirmação. A tela foi atualizada; confira e confirme de novo.',
        code: 'AGENTE_MUDOU',
      }, 409),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Excluir agente' })).getByRole('button', { name: 'Excluir de vez' }));
    const dialogo = screen.getByRole('dialog', { name: 'Excluir agente' });
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('O agente mudou desde que você abriu esta confirmação.');
    expect(await within(dialogo).findByText(/^Excluir o agente Aurora renomeada\?/)).toBeInTheDocument();
    expect(leituras).toBe(2);
    expect(navegar).not.toHaveBeenCalled();
  });

  it('em edição, Excluir fica travado com o motivo', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente({ numeros: [] }) }) }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const excluir = screen.getByRole('button', { name: 'Excluir' });
    expect(excluir).toBeDisabled();
    expect(excluir).toHaveAttribute('title', 'Salve ou cancele a edição antes de excluir.');
  });
});
