// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelCalendarSettings } from './ChannelCalendarSettings';

afterEach(() => vi.restoreAllMocks());

describe('ChannelCalendarSettings', () => {
  it('mantem a agenda desativada por padrao e salva o contrato 40/60', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const onSaved = vi.fn();
    render(
      <ChannelCalendarSettings
        tenantId="11111111-1111-4111-8111-111111111111"
        connectionId="22222222-2222-4222-8222-222222222222"
        initialCalendar={null}
        assignees={[{ id: '33333333-3333-4333-8333-333333333333', display_name: 'Junior' }]}
        disabled={false}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByText(/Desativada até configurar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Agenda da IA/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Permitir que a IA/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(options.body));
    expect(payload.config.calendar).toMatchObject({
      enabled: true,
      timezone: 'America/Sao_Paulo',
      minimumNoticeMinutes: 60,
      schedulingHorizonDays: 14,
      ownerId: '33333333-3333-4333-8333-333333333333',
    });
    expect(payload.config.calendar.weeklyHours.monday).toEqual([{ start: '09:00', end: '19:00' }]);
    expect(payload.config.calendar.weeklyHours.saturday).toEqual([]);
    expect(payload.config.calendar.humanConfirmationWeekdays).toEqual(['saturday']);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('permite dividir o expediente em mais de uma faixa no mesmo dia', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    render(
      <ChannelCalendarSettings
        tenantId="11111111-1111-4111-8111-111111111111"
        connectionId="22222222-2222-4222-8222-222222222222"
        initialCalendar={null}
        assignees={[{ id: '33333333-3333-4333-8333-333333333333', display_name: 'Junior' }]}
        disabled={false}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Agenda da IA/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Permitir que a IA/ }));
    fireEvent.click(screen.getByRole('button', { name: /Adicionar faixa em segunda/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.config.calendar.weeklyHours.monday).toEqual([
      { start: '09:00', end: '19:00' },
      { start: '09:00', end: '19:00' },
    ]);
  });
});

describe('ChannelCalendarSettings — Google Agenda (SPEC-google-agenda.md, Fatia 1)', () => {
  function renderPanel() {
    render(
      <ChannelCalendarSettings
        tenantId="11111111-1111-4111-8111-111111111111"
        connectionId="22222222-2222-4222-8222-222222222222"
        initialCalendar={null}
        assignees={[{ id: '33333333-3333-4333-8333-333333333333', display_name: 'Junior' }]}
        disabled={false}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Agenda da IA/ }));
  }

  it('nao consulta o status so por expandir a Agenda da IA (lazy, so no proprio toggle)', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ao abrir "Google Agenda", consulta o status; sem integração configurada mostra aviso e nenhum botão', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ configured: false, connected: false, googleAccountEmail: null, status: null, connectedAt: null }), { status: 200 }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Google Agenda' }));

    await waitFor(() => expect(screen.getByText(/ainda não configurada/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Conectar Google Agenda/ })).not.toBeInTheDocument();
  });

  it('configurado e desconectado: mostra "Conectar Google Agenda" e inicia o fluxo com POST + window.location', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/google-calendar/status')) {
        return Promise.resolve(new Response(JSON.stringify({ configured: true, connected: false, googleAccountEmail: null, status: null, connectedAt: null }), { status: 200 }));
      }
      if (url.endsWith('/google-calendar/connect')) {
        return Promise.resolve(new Response(JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }), { status: 200 }));
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Google Agenda' }));
    const connectButton = await screen.findByRole('button', { name: /Conectar Google Agenda/ });
    fireEvent.click(connectButton);

    await waitFor(() => expect(window.location.href).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    const connectCall = fetchMock.mock.calls.find(call => String(call[0]).endsWith('/google-calendar/connect'));
    expect((connectCall?.[1] as RequestInit).method).toBe('POST');

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('conectado: mostra o e-mail e desconecta via POST /disconnect', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/google-calendar/status')) {
        return Promise.resolve(new Response(JSON.stringify({ configured: true, connected: true, googleAccountEmail: 'cenourahub@gmail.com', status: 'connected', connectedAt: '2026-09-22T00:00:00.000Z' }), { status: 200 }));
      }
      if (url.endsWith('/google-calendar/disconnect')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, warning: null }), { status: 200 }));
      }
      throw new Error(`fetch inesperado: ${url}`);
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Google Agenda' }));
    const disconnectButton = await screen.findByRole('button', { name: 'Desconectar' });
    expect(screen.getByText((_content, element) =>
      element?.tagName.toLowerCase() === 'span' && Boolean(element.textContent?.includes('cenourahub@gmail.com')),
    )).toBeInTheDocument();

    fireEvent.click(disconnectButton);
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/google-calendar/disconnect'))).toBe(true));
  });

  it('status reconnect_required: mostra "Reconectar" em vez de "Conectar Google Agenda"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ configured: true, connected: false, googleAccountEmail: 'cenourahub@gmail.com', status: 'reconnect_required', connectedAt: '2026-09-22T00:00:00.000Z' }), { status: 200 }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Google Agenda' }));
    await screen.findByRole('button', { name: 'Reconectar' });
    expect(screen.queryByRole('button', { name: /^Conectar Google Agenda$/ })).not.toBeInTheDocument();
  });
});

describe('ChannelCalendarSettings — escolha de agendas (SPEC-google-agenda.md, Fatia 5)', () => {
  const AGENDAS = [
    { id: 'sdr@group.calendar.google.com', summary: 'Cenoura - SDR', primary: false, accessRole: 'owner', backgroundColor: '#f87000' },
    { id: 'cenourahub@gmail.com', summary: 'Cenoura Hub', primary: true, accessRole: 'owner', backgroundColor: null },
    { id: 'pessoal@group.calendar.google.com', summary: 'Pessoal', primary: false, accessRole: 'writer', backgroundColor: null },
    { id: 'feriados@group.v.calendar.google.com', summary: 'Feriados no Brasil', primary: false, accessRole: 'reader', backgroundColor: null },
  ];

  function statusConectado(extra: Record<string, unknown> = {}) {
    return {
      configured: true,
      connected: true,
      googleAccountEmail: 'cenourahub@gmail.com',
      status: 'connected',
      connectedAt: '2026-09-22T00:00:00.000Z',
      writeCalendarId: 'sdr@group.calendar.google.com',
      writeCalendarSummary: 'Cenoura - SDR',
      busyCalendarIds: [],
      canListCalendars: true,
      ...extra,
    };
  }

  function mockarRede(options: {
    status?: Record<string, unknown>;
    calendars?: Record<string, unknown>;
    selection?: { body: Record<string, unknown>; status: number };
  } = {}) {
    const statusBody = options.status ?? statusConectado();
    const calendarsBody = options.calendars ?? {
      connected: true,
      needsReconnect: false,
      writeCalendarId: 'sdr@group.calendar.google.com',
      busyCalendarIds: [],
      calendars: AGENDAS,
    };
    const selection = options.selection ?? {
      body: { ok: true, writeCalendarId: 'sdr@group.calendar.google.com', writeCalendarSummary: 'Cenoura - SDR', busyCalendarIds: ['pessoal@group.calendar.google.com'] },
      status: 200,
    };

    return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/google-calendar/status')) {
        return Promise.resolve(new Response(JSON.stringify(statusBody), { status: 200 }));
      }
      if (url.endsWith('/google-calendar/calendars')) {
        return Promise.resolve(new Response(JSON.stringify(calendarsBody), { status: 200 }));
      }
      if (url.endsWith('/google-calendar/selection')) {
        return Promise.resolve(new Response(JSON.stringify(selection.body), { status: selection.status }));
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
  }

  function abrirGoogleAgenda() {
    render(
      <ChannelCalendarSettings
        tenantId="11111111-1111-4111-8111-111111111111"
        connectionId="22222222-2222-4222-8222-222222222222"
        initialCalendar={null}
        assignees={[{ id: '33333333-3333-4333-8333-333333333333', display_name: 'Junior' }]}
        disabled={false}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Agenda da IA/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Google Agenda' }));
  }

  function chamadas(fetchMock: ReturnType<typeof mockarRede>, sufixo: string) {
    return fetchMock.mock.calls.filter(call => String(call[0]).endsWith(sufixo));
  }

  it('lista as agendas, oferece só as de escrita no seletor e começa na agenda atual', async () => {
    mockarRede();
    abrirGoogleAgenda();

    const seletor = await screen.findByRole('combobox', { name: /Agenda onde a IA marca/ }) as HTMLSelectElement;
    expect(seletor.value).toBe('sdr@group.calendar.google.com');
    expect(screen.getByRole('option', { name: 'Cenoura - SDR' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cenoura Hub (principal)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pessoal' })).toBeInTheDocument();
    // Agenda só de leitura não pode receber reunião.
    expect(screen.queryByRole('option', { name: /Feriados no Brasil/ })).not.toBeInTheDocument();
    // Mas continua disponível para bloquear/avisar.
    const feriados = screen.getByRole('combobox', { name: /O que a agenda Feriados no Brasil faz/ });
    expect(feriados).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Só avisar' }).length).toBeGreaterThan(0);
  });

  it('mandar uma agenda BLOQUEAR e salvar manda um PUT único com a seleção', async () => {
    const fetchMock = mockarRede();
    abrirGoogleAgenda();

    const pessoal = await screen.findByRole('combobox', { name: /O que a agenda Pessoal faz/ });
    fireEvent.change(pessoal, { target: { value: 'bloqueia' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar escolha de agendas/ }));

    await waitFor(() => expect(chamadas(fetchMock, '/google-calendar/selection')).toHaveLength(1));
    const [, init] = chamadas(fetchMock, '/google-calendar/selection')[0] as [unknown, RequestInit];
    expect(init.method).toBe('PUT');
    const corpo = JSON.parse(String(init.body));
    expect(corpo.writeCalendarId).toBe('sdr@group.calendar.google.com');
    expect(corpo.writeCalendarSummary).toBe('Cenoura - SDR');
    expect(corpo.busyCalendarIds).toContain('pessoal@group.calendar.google.com');
    expect(corpo.busyCalendarIds).not.toContain('sdr@group.calendar.google.com');
    await screen.findByText('Agendas salvas.');
  });

  it('SÓ AVISAR vai na lista de observação e NÃO na de bloqueio (pedido do Junior, 22/09)', async () => {
    const fetchMock = mockarRede();
    abrirGoogleAgenda();

    const principal = await screen.findByRole('combobox', { name: /O que a agenda Cenoura Hub faz/ });
    fireEvent.change(principal, { target: { value: 'avisa' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar escolha de agendas/ }));

    await waitFor(() => expect(chamadas(fetchMock, '/google-calendar/selection')).toHaveLength(1));
    const [, init] = chamadas(fetchMock, '/google-calendar/selection')[0] as [unknown, RequestInit];
    const corpo = JSON.parse(String(init.body));
    expect(corpo.watchCalendarIds).toContain('cenourahub@gmail.com');
    expect(corpo.busyCalendarIds ?? []).not.toContain('cenourahub@gmail.com');
  });

  it('trocar de AVISAR para BLOQUEAR tira da lista de observação (os dois papéis são exclusivos)', async () => {
    const fetchMock = mockarRede();
    abrirGoogleAgenda();

    const principal = await screen.findByRole('combobox', { name: /O que a agenda Cenoura Hub faz/ });
    fireEvent.change(principal, { target: { value: 'avisa' } });
    fireEvent.change(principal, { target: { value: 'bloqueia' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar escolha de agendas/ }));

    await waitFor(() => expect(chamadas(fetchMock, '/google-calendar/selection')).toHaveLength(1));
    const corpo = JSON.parse(String((chamadas(fetchMock, '/google-calendar/selection')[0] as [unknown, RequestInit])[1].body));
    expect(corpo.busyCalendarIds).toContain('cenourahub@gmail.com');
    expect(corpo.watchCalendarIds).not.toContain('cenourahub@gmail.com');
  });

  it('a agenda de escrita nao tem seletor: ela sempre conta como ocupado e o texto diz isso', async () => {
    mockarRede();
    abrirGoogleAgenda();

    await screen.findByText(/Cenoura - SDR — é onde a IA marca, sempre conta como ocupado/);
    expect(screen.queryByRole('combobox', { name: /O que a agenda Cenoura - SDR faz/ })).not.toBeInTheDocument();
  });

  it('conexão antiga (canListCalendars: false): sem seletor, sem caixas, com aviso e botão Reconectar', async () => {
    const fetchMock = mockarRede({ status: statusConectado({ canListCalendars: false }) });
    abrirGoogleAgenda();

    await screen.findByText(/reconecte uma vez/i);
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Agenda onde a IA marca/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /O que a agenda/ })).not.toBeInTheDocument();
    // Sem permissão de listar, nem vale gastar a chamada.
    expect(chamadas(fetchMock, '/google-calendar/calendars')).toHaveLength(0);
  });

  it('lista com needsReconnect: true também esconde os controles e pede reconexão', async () => {
    mockarRede({ calendars: { connected: true, needsReconnect: true, calendars: [] } });
    abrirGoogleAgenda();

    await screen.findByText(/reconecte uma vez/i);
    expect(screen.queryByRole('combobox', { name: /Agenda onde a IA marca/ })).not.toBeInTheDocument();
  });

  it('erro no PUT mostra a mensagem e mantém a tela de pé', async () => {
    mockarRede({ selection: { body: { error: 'Escolha de agenda inválida.' }, status: 500 } });
    abrirGoogleAgenda();

    const seletor = await screen.findByRole('combobox', { name: /Agenda onde a IA marca/ });
    fireEvent.click(screen.getByRole('button', { name: /Salvar escolha de agendas/ }));

    await screen.findByText('Escolha de agenda inválida.');
    expect(seletor).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar escolha de agendas/ })).toBeEnabled();
  });

  it('regressão: com o painel Google Agenda fechado, nenhuma chamada a /calendars acontece', async () => {
    const fetchMock = mockarRede();
    render(
      <ChannelCalendarSettings
        tenantId="11111111-1111-4111-8111-111111111111"
        connectionId="22222222-2222-4222-8222-222222222222"
        initialCalendar={null}
        assignees={[{ id: '33333333-3333-4333-8333-333333333333', display_name: 'Junior' }]}
        disabled={false}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Agenda da IA/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Google Agenda' })).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
