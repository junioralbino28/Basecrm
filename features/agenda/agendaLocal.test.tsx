import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  vagasDoDia,
  paraIsoLocal,
  horaLocalDe,
  HORA_INICIO,
  MINUTOS_POR_VAGA,
} from './hooks/useAgendaLocalController';
import { AgendaGradeDia } from './components/AgendaGradeDia';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import type { Professional } from '@/types';

/**
 * Agenda NOSSA — fatia 1 (Junior, 28/07/2026). Grade no padrão Clinicorp:
 * colunas por dentista, meia em meia hora. Nada aqui toca o Clinicorp.
 */
describe('grade do dia — vagas e conversão de horário', () => {
  it('a grade vai de 08:00 a 18:30, de meia em meia hora', () => {
    const vagas = vagasDoDia();
    expect(vagas[0]).toBe('08:00');
    expect(vagas.at(-1)).toBe('18:30');
    expect(vagas).toHaveLength(22);
    expect(HORA_INICIO).toBe(8);
    expect(MINUTOS_POR_VAGA).toBe(30);
  });

  it('ida e volta de horário local preserva a hora (independe de fuso)', () => {
    const iso = paraIsoLocal('2026-07-28', '14:30');
    expect(horaLocalDe(iso)).toBe('14:30');
  });
});

const DENTISTAS: Professional[] = [
  { id: 'pro-a', name: 'Dra. Ana', active: true } as Professional,
  { id: 'pro-b', name: 'Dr. Bruno', active: true } as Professional,
];

function consulta(extra: Partial<AppointmentDoDia>): AppointmentDoDia {
  return {
    id: 'appt-1',
    startsAt: paraIsoLocal('2026-07-28', '09:00'),
    endsAt: paraIsoLocal('2026-07-28', '09:30'),
    status: 'agendado',
    source: 'manual',
    professionalId: 'pro-a',
    contactName: 'Paciente Teste',
    contactPhone: null,
    professionalName: 'Dra. Ana',
    ...extra,
  } as AppointmentDoDia;
}

describe('AgendaGradeDia', () => {
  it('mostra colunas por dentista e a consulta na célula certa', () => {
    render(
      <AgendaGradeDia
        appointments={[consulta({})]}
        professionals={DENTISTAS}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Dra. Ana' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Dr. Bruno' })).toBeInTheDocument();
    expect(screen.getByText('Paciente Teste')).toBeInTheDocument();
    // vaga livre clicável identifica dentista e hora em linguagem de gente
    expect(screen.getByRole('button', { name: 'Marcar 09:00 com Dr. Bruno' })).toBeInTheDocument();
  });

  it('consulta de 60 minutos ocupa DUAS linhas — a continuação não vira vaga livre', () => {
    render(
      <AgendaGradeDia
        appointments={[consulta({ endsAt: paraIsoLocal('2026-07-28', '10:00') })]}
        professionals={DENTISTAS}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Marcar 09:30 com Dra. Ana' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar 09:30 com Dr. Bruno' })).toBeInTheDocument();
  });

  it('consulta CANCELADA não segura a vaga — dá pra marcar por cima', () => {
    render(
      <AgendaGradeDia
        appointments={[consulta({ status: 'cancelado', endsAt: paraIsoLocal('2026-07-28', '10:00') })]}
        professionals={DENTISTAS}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    // o card cancelado aparece riscado, mas a meia hora SEGUINTE volta a ser livre
    expect(screen.getByText('Paciente Teste')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar 09:30 com Dra. Ana' })).toBeInTheDocument();
  });

  it('marcação vinda do Clinicorp é etiquetada (fatia 3 vai povoar isso)', () => {
    render(
      <AgendaGradeDia
        appointments={[consulta({ source: 'clinicorp_api' })]}
        professionals={DENTISTAS}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByText(/veio do Clinicorp/)).toBeInTheDocument();
  });
});
