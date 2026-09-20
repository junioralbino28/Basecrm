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
