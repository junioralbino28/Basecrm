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
