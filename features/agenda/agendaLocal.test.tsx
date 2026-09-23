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
import { COLUNA_PADRAO_ID } from './components/agendaFormato';
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

/**
 * "Essa tela nao pode ficar vazia" (Junior, 22/09/2026). Sem equipe cadastrada a agenda
 * tem de existir do mesmo jeito, numa coluna so, e ja mostrar o que a IA marcou.
 */
describe('agenda sem equipe cadastrada — a coluna padrao', () => {
  const COLUNA_PADRAO: Professional[] = [
    { id: COLUNA_PADRAO_ID, name: 'CENNO HUB', active: true } as Professional,
  ];

  it('desenha a grade inteira com UMA coluna, em vez da mensagem de "cadastre a equipe"', () => {
    render(
      <AgendaGradeDia
        appointments={[]}
        professionals={COLUNA_PADRAO}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Cadastre os profissionais/)).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'CENNO HUB' })).toBeInTheDocument();
    // A grade inteira continua clicavel: 22 vagas de 08:00 a 18:30.
    expect(screen.getAllByRole('button', { name: /^Marcar \d{2}:\d{2} com CENNO HUB$/ })).toHaveLength(22);
  });

  it('compromisso SEM profissional aparece na coluna padrao (antes sumia da tela)', () => {
    render(
      <AgendaGradeDia
        appointments={[consulta({ professionalId: undefined, professionalName: null })]}
        professionals={COLUNA_PADRAO}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByText('Paciente Teste')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar 09:00 com CENNO HUB' })).not.toBeInTheDocument();
  });

  it('a reuniao que a IA marcou entra na grade, com a origem visivel', () => {
    render(
      <AgendaGradeDia
        appointments={[consulta({
          id: 'aurora:abc', professionalId: undefined, professionalName: null,
          source: 'aurora', contactName: 'Marina Souza', somenteLeitura: true,
        })]}
        professionals={COLUNA_PADRAO}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByText('Marina Souza')).toBeInTheDocument();
    expect(screen.getByText(/marcada pela IA/)).toBeInTheDocument();
  });

  it('COM equipe cadastrada, compromisso sem profissional continua FORA (nao inventa coluna)', () => {
    render(
      <AgendaGradeDia
        appointments={[consulta({ professionalId: undefined, professionalName: null })]}
        professionals={DENTISTAS}
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.queryByText('Paciente Teste')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar 09:00 com Dra. Ana' })).toBeInTheDocument();
  });
});
