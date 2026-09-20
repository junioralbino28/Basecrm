// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarBlocksPanel } from './CalendarBlocksPanel';

afterEach(() => vi.restoreAllMocks());

describe('CalendarBlocksPanel', () => {
  it('carrega e cria um almoço recorrente pelo painel', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ blocks: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        block: {
          id: '11111111-1111-4111-8111-111111111111', title: 'Almoço', kind: 'lunch',
          recurrence: 'weekly', blockDate: null, weekdays: ['monday'], start: '12:00', end: '13:00', allDay: false,
        },
      }), { status: 201 }));

    render(<CalendarBlocksPanel tenantId="tenant-a" connectionId="channel-a" disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Bloqueios de almoço/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar bloqueio' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toMatchObject({
      title: 'Almoço', recurrence: 'weekly', start: '12:00', end: '13:00', allDay: false,
    });
    expect(await screen.findByText(/Toda semana/)).toBeInTheDocument();
  });
});
