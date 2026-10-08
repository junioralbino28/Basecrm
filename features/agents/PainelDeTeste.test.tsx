import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgenteNoEditor, ResultadoDoTeste, RetratoDoTeste } from '@/lib/agents/tiposDoEditor';
import { PainelDeTeste } from './PainelDeTeste';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE_ID = '22222222-2222-4222-8222-222222222222';
const URL_TESTE = `/api/platform/tenants/${TENANT}/agents/${AGENTE_ID}/test`;
const URL_EXPLICAR = `${URL_TESTE}/explain`;

const RETRATO: RetratoDoTeste = { prompt: 'prompt renderizado', provedor: 'google', modelo: 'gemini-3-flash', expiraEm: 1_900_000_000_000, assinatura: 'a'.repeat(64) };

function agente(extra: Partial<AgenteNoEditor> = {}): AgenteNoEditor {
  return {
    id: AGENTE_ID,
    nome: 'Aurora',
    cliente: { id: TENANT, nome: 'Cenno Hub' },
    publicada: null,
    rascunho: { prompt: 'Voce e a Aurora.', revisao: 4, atualizadoEm: null, atualizadoPor: null },
    numeros: [
      { id: 'n1', nome: 'Comercial', temAgenda: true },
      { id: 'n2', nome: 'Suporte', temAgenda: false },
    ],
    ...extra,
  };
}

function resultado(extra: Partial<ResultadoDoTeste> = {}, oQueFez: Partial<ResultadoDoTeste['oQueFez']> = {}): ResultadoDoTeste {
  return {
    partes: ['Oi! Tudo bem?'],
    oQueFez: {
      repasse: null,
      horarioPedido: null,
      lead: { nome: null, email: null, empresa: null, segmento: null },
      etiquetas: null,
      gateDeCapacidade: null,
      resumo: null,
      conversaEncerrada: false,
      ...oQueFez,
    },
    tempo: { total_ms: 2300, setup_ms: 100, calendar_ms: 0, model_ms: 2100, model_http_calls: 1, model_http_errors: [], generations: 1, repaired: false },
    uso: { entrada: 1234, saida: 56, raciocinio: null, entradaEmCache: null },
    prompt: { origem: 'rascunho', revisao: 4, versao: null, sha256: 'b'.repeat(64) },
    numero: { id: 'n1', nome: 'Comercial', referenciaHipotetica: false },
    modelo: 'gemini-3-flash',
    retrato: RETRATO,
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

const corpos = (fetchMock: ReturnType<typeof fetchFalso>, url: string) =>
  fetchMock.mock.calls.filter(([u]) => String(u) === url).map(([, init]) => JSON.parse(String(init?.body)));

function abrir(props: Partial<React.ComponentProps<typeof PainelDeTeste>> = {}) {
  const onFechar = vi.fn();
  const onMudou = vi.fn();
  const r = render(<PainelDeTeste tenantId={TENANT} agente={agente()} onFechar={onFechar} onMudou={onMudou} {...props} />);
  return { ...r, onFechar, onMudou };
}

async function enviar(texto: string) {
  fireEvent.change(screen.getByLabelText('Mensagem do lead'), { target: { value: texto } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  await waitFor(() => expect(screen.queryByText('Gerando a resposta...')).not.toBeInTheDocument());
}

const baloes = (container: HTMLElement, autor: 'lead' | 'agente') =>
  [...container.querySelectorAll(`[data-autor="${autor}"]`)].map((el) => el.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PainelDeTeste', () => {
  it('abre com o aviso e o primeiro número ligado como referência; Esc e o fundo fecham', () => {
    const { onFechar } = abrir();
    const painel = screen.getByRole('dialog', { name: 'Testar sem enviar' });
    expect(within(painel).getByText('Nada aqui vai para o WhatsApp. A conversa simulada não é gravada.')).toBeInTheDocument();
    const numero = within(painel).getByLabelText('Número de referência') as HTMLSelectElement;
    expect(numero.value).toBe('n1');
    expect([...numero.options].map((o) => o.textContent)).toEqual(['Comercial', 'Suporte', 'Sem número (sem agenda)']);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('fundo-do-teste'));
    expect(onFechar).toHaveBeenCalledTimes(2);
  });

  it('enviar manda a revisão, a mensagem e o número; as partes aparecem como balões do agente', async () => {
    const fetchMock = fetchFalso({ [`POST ${URL_TESTE}`]: () => responder(resultado({ partes: ['Oi!', 'Como posso ajudar?'] })) });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = abrir();

    await enviar('  Oi  ');
    expect(corpos(fetchMock, URL_TESTE)).toEqual([{ revisao: 4, mensagens: [{ autor: 'lead', texto: 'Oi' }], numeroId: 'n1' }]);
    expect(baloes(container, 'lead')).toEqual(['Oi']);
    expect(baloes(container, 'agente')).toEqual(['Oi!', 'Como posso ajudar?']);
    expect((screen.getByLabelText('Mensagem do lead') as HTMLTextAreaElement).value).toBe('');
  });

  it('Enter envia e Shift+Enter não; "Sem número" e o nome do lead vão no corpo', async () => {
    const fetchMock = fetchFalso({ [`POST ${URL_TESTE}`]: () => responder(resultado()) });
    vi.stubGlobal('fetch', fetchMock);
    abrir();
    fireEvent.change(screen.getByLabelText('Número de referência'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Nome do lead (opcional)'), { target: { value: ' Ana ' } });

    const campo = screen.getByLabelText('Mensagem do lead');
    fireEvent.change(campo, { target: { value: 'Oi' } });
    fireEvent.keyDown(campo, { key: 'Enter', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(campo, { key: 'Enter' });
    await screen.findByText('Oi! Tudo bem?');
    expect(corpos(fetchMock, URL_TESTE)).toEqual([
      { revisao: 4, mensagens: [{ autor: 'lead', texto: 'Oi' }], numeroId: null, nomeDoLead: 'Ana' },
    ]);
  });

  it('texto do modelo com HTML aparece literal e nenhum elemento é criado a partir dele (G16)', async () => {
    const IMG = '<img src=x onerror=alert(1)>';
    const SCRIPT = '<script>alert(1)</script>';
    vi.stubGlobal(
      'fetch',
      fetchFalso({
        [`POST ${URL_TESTE}`]: () =>
          responder(resultado({ partes: ['<b>oi</b>'] }, { repasse: { tipo: 'human_requested', motivo: IMG }, resumo: IMG })),
        [`POST ${URL_EXPLICAR}`]: () => responder({ explicacao: SCRIPT }),
      }),
    );
    const { container } = abrir();
    await enviar('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Explicar esta resposta' }));
    await screen.findByText(SCRIPT);

    expect(screen.getByText('<b>oi</b>')).toBeInTheDocument();
    expect(screen.getAllByText(IMG)).toHaveLength(2);
    expect(container.querySelector('img, b, script')).toBeNull();
  });

  it('a segunda pergunta manda o histórico com as partes do agente, cortado nas 30 últimas', async () => {
    let n = 0;
    const fetchMock = fetchFalso({
      [`POST ${URL_TESTE}`]: () => {
        n += 1;
        return responder(resultado({ partes: [`r${n}-1`, `r${n}-2`, `r${n}-3`] }));
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    abrir();

    await enviar('p1');
    await enviar('p2');
    expect(corpos(fetchMock, URL_TESTE)[1].mensagens).toEqual([
      { autor: 'lead', texto: 'p1' },
      { autor: 'agente', texto: 'r1-1' },
      { autor: 'agente', texto: 'r1-2' },
      { autor: 'agente', texto: 'r1-3' },
      { autor: 'lead', texto: 'p2' },
    ]);

    // 8 rodadas de 4 mensagens = 32 no histórico; a 9ª pergunta somaria 33 e vai só com as 30 últimas.
    for (let k = 3; k <= 9; k += 1) await enviar(`p${k}`);
    const ultima = corpos(fetchMock, URL_TESTE)[8].mensagens;
    expect(ultima).toHaveLength(30);
    expect(ultima[0]).toEqual({ autor: 'agente', texto: 'r1-3' });
    expect(ultima[29]).toEqual({ autor: 'lead', texto: 'p9' });
  });

  it('"O que o agente fez" mostra só o que veio: repasse com motivo, horário pedido, nome captado, tempo, tokens e a versão', async () => {
    vi.stubGlobal(
      'fetch',
      fetchFalso({
        [`POST ${URL_TESTE}`]: () =>
          responder(
            resultado({}, {
              repasse: { tipo: 'meeting_requested', motivo: 'quer marcar uma conversa' },
              horarioPedido: { em: '2026-10-09T17:00:00.000Z', texto: 'amanhã às 14h' },
              lead: { nome: 'Ana', email: null, empresa: null, segmento: null },
            }),
          ),
      }),
    );
    abrir();
    await enviar('Quero marcar amanhã às 14h');
    const bloco = screen.getByRole('region', { name: 'O que o agente fez' });
    expect(within(bloco).getByText('o lead quer agendar uma reunião')).toBeInTheDocument();
    expect(within(bloco).getByText('quer marcar uma conversa')).toBeInTheDocument();
    expect(within(bloco).getByText('09/10/2026 às 14:00 ("amanhã às 14h")')).toBeInTheDocument();
    expect(within(bloco).getByText('Ana')).toBeInTheDocument();
    expect(within(bloco).queryByText('E-mail captado:')).not.toBeInTheDocument();
    expect(within(bloco).getByText('Respondeu em 2,3 s (modelo 2,1 s) · 1.234 tokens de entrada, 56 de saída · modelo gemini-3-flash')).toBeInTheDocument();
    expect(within(bloco).getByText('Testando o rascunho salvo (revisão 4)')).toBeInTheDocument();
    expect(within(bloco).queryByText(/Referência hipotética/)).not.toBeInTheDocument();
  });

  it('explicar manda o retrato e a resposta exatamente como vieram do teste; sem retrato não há botão; vencido mostra o motivo', async () => {
    const repasse = { tipo: 'human_requested', motivo: 'pediu uma pessoa' };
    let explicacoes = 0;
    const fetchMock = fetchFalso({
      [`POST ${URL_TESTE}`]: () => responder(resultado({ partes: ['Já te passo.'], prompt: { origem: 'publicada', revisao: 7, versao: 3, sha256: 'c'.repeat(64) } }, { repasse })),
      [`POST ${URL_EXPLICAR}`]: () => {
        explicacoes += 1;
        return explicacoes === 1
          ? responder({ explicacao: 'O prompt manda repassar quando pedem uma pessoa.' })
          : responder({ error: 'O teste tem mais de 15 minutos. Teste de novo para explicar.', code: 'RETRATO_VENCIDO' }, 409);
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    abrir();
    await enviar('Quero falar com alguém');
    expect(screen.getByText('Testando a versão publicada 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Explicar esta resposta' }));
    expect(await screen.findByText('O prompt manda repassar quando pedem uma pessoa.')).toBeInTheDocument();
    expect(screen.getByText('Explicação gerada depois da resposta. Ela não muda o que foi respondido.')).toBeInTheDocument();
    expect(corpos(fetchMock, URL_EXPLICAR)).toEqual([{ revisao: 7, retrato: RETRATO, resposta: { partes: ['Já te passo.'], repasse } }]);

    fireEvent.click(screen.getByRole('button', { name: 'Explicar esta resposta' }));
    expect(await screen.findByText('O teste tem mais de 15 minutos. Teste de novo para explicar.')).toBeInTheDocument();
  });

  it('explicação que chega depois de uma pergunta nova não aparece sob a resposta nova', async () => {
    let soltarExplicacao: (r: Response) => void = () => undefined;
    let n = 0;
    vi.stubGlobal(
      'fetch',
      fetchFalso({
        [`POST ${URL_TESTE}`]: () => {
          n += 1;
          return responder(resultado({ partes: [`resposta ${n}`] }));
        },
        [`POST ${URL_EXPLICAR}`]: () => new Promise<Response>((soltar) => { soltarExplicacao = soltar; }),
      }),
    );
    abrir();
    await enviar('primeira');
    fireEvent.click(screen.getByRole('button', { name: 'Explicar esta resposta' }));
    expect(screen.getByText('Gerando a explicação...')).toBeInTheDocument();
    await enviar('segunda');
    await screen.findByText('resposta 2');

    await act(async () => {
      soltarExplicacao(new Response(JSON.stringify({ explicacao: 'explicação da primeira' }), { status: 200 }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText('explicação da primeira')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explicar esta resposta' })).toBeEnabled();
  });

  it('resposta sem retrato não oferece a explicação', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`POST ${URL_TESTE}`]: () => responder(resultado({ retrato: null })) }));
    abrir();
    await enviar('Oi');
    expect(screen.getByRole('button', { name: 'Recomeçar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explicar esta resposta' })).not.toBeInTheDocument();
  });

  it('rascunho mudou: mensagem, botão de recarregar e o texto de volta no campo; 429 e 504 mostram a mensagem do servidor', async () => {
    const respostas = [
      responder({ error: 'O rascunho mudou depois que esta tela foi aberta. Recarregue antes de testar.', code: 'RASCUNHO_MUDOU' }, 409),
      responder({ error: 'Muitos testes ao mesmo tempo. Espere a resposta anterior. Tente de novo em 12 s.', code: 'LIMITE_DE_TESTES' }, 429),
      responder({ error: 'O modelo demorou demais para responder. Tente de novo.', code: 'MODELO_DEMOROU' }, 504),
    ];
    vi.stubGlobal('fetch', fetchFalso({ [`POST ${URL_TESTE}`]: () => respostas.shift()! }));
    const { container, onMudou } = abrir();

    await enviar('Oi');
    const alerta = screen.getByRole('alert');
    expect(within(alerta).getByText('O rascunho mudou depois que esta tela foi aberta. Recarregue antes de testar.')).toBeInTheDocument();
    expect(baloes(container, 'lead')).toEqual([]);
    expect((screen.getByLabelText('Mensagem do lead') as HTMLTextAreaElement).value).toBe('Oi');
    fireEvent.click(within(alerta).getByRole('button', { name: 'Recarregar o agente' }));
    expect(onMudou).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await enviar('Oi');
    expect(screen.getByRole('alert')).toHaveTextContent('Muitos testes ao mesmo tempo. Espere a resposta anterior. Tente de novo em 12 s.');
    expect(screen.queryByRole('button', { name: 'Recarregar o agente' })).not.toBeInTheDocument();

    await enviar('Oi');
    expect(screen.getByRole('alert')).toHaveTextContent('O modelo demorou demais para responder. Tente de novo.');
  });

  it('Recomeçar limpa a conversa', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`POST ${URL_TESTE}`]: () => responder(resultado()) }));
    const { container } = abrir();
    await enviar('Oi');
    expect(baloes(container, 'agente')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Recomeçar' }));
    expect(baloes(container, 'lead')).toEqual([]);
    expect(baloes(container, 'agente')).toEqual([]);
    expect(screen.getByText('Escreva a primeira mensagem como se fosse o lead.')).toBeInTheDocument();
  });

  it('número que não responde por este agente: a linha de referência hipotética', async () => {
    vi.stubGlobal(
      'fetch',
      fetchFalso({ [`POST ${URL_TESTE}`]: () => responder(resultado({ numero: { id: 'n9', nome: 'Outro', referenciaHipotetica: true } })) }),
    );
    abrir();
    await enviar('Oi');
    expect(screen.getByText('Referência hipotética: este número não responde por este agente.')).toBeInTheDocument();
  });

  it('reunião confirmada: a frase de simulação, sem prometer reserva', async () => {
    vi.stubGlobal(
      'fetch',
      fetchFalso({
        [`POST ${URL_TESTE}`]: () =>
          responder(
            resultado({}, {
              repasse: { tipo: 'meeting_confirmed', motivo: null },
              horarioPedido: { em: '2026-10-09T17:00:00.000Z', texto: null },
            }),
          ),
      }),
    );
    abrir();
    await enviar('Pode ser amanhã às 14h');
    expect(
      screen.getByText(
        'Confirmaria a reunião de 09/10/2026 às 14:00 (simulação: no teste nada é reservado; no atendimento real, se a reserva falhar, o texto muda)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Horário pedido:')).not.toBeInTheDocument();
  });
});
