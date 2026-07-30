import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  inicioDaSemana,
  diasDaSemana,
  celulasDoMes,
  intervaloDaVisao,
  somarDias,
  paraIsoLocal,
} from './hooks/useAgendaLocalController';
import { AgendaGradeSemana } from './components/AgendaGradeSemana';
import { AgendaGradeMes } from './components/AgendaGradeMes';
import { diaLocalDe, rotuloCurtoDoDia, rotuloDoMes } from './components/agendaFormato';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';

/**
 * Agenda — visões de SEMANA e MÊS por profissional (Junior, 29/07/2026:
 * "ver em forma de calendário a semana e o mês a agenda individual de cada
 * profissional"). Leitura pura sobre a mesma consulta da fatia 1.
 */

describe('janelas de data das visões', () => {
  it('a semana começa na SEGUNDA — inclusive quando a data é domingo', () => {
    // 2026-07-29 é uma quarta; a segunda dessa semana é 27/07.
    expect(inicioDaSemana('2026-07-29')).toBe('2026-07-27');
    // domingo 02/08 ainda pertence à semana que começou em 27/07
    expect(inicioDaSemana('2026-08-02')).toBe('2026-07-27');
  });

  it('a semana mostra os 7 dias — domingo não pode sumir da tela', () => {
    const dias = diasDaSemana('2026-07-29');
    expect(dias).toHaveLength(7);
    expect(dias[0]).toBe('2026-07-27');
    expect(dias[6]).toBe('2026-08-02');
  });

  it('o mês vai do dia 1 ao último dia, e o intervalo do dia é de 1 dia só', () => {
    expect(intervaloDaVisao('mes', '2026-07-29')).toEqual({ de: '2026-07-01', ate: '2026-08-01' });
    expect(intervaloDaVisao('semana', '2026-07-29')).toEqual({ de: '2026-07-27', ate: '2026-08-03' });
    expect(intervaloDaVisao('dia', '2026-07-29')).toEqual({ de: '2026-07-29', ate: '2026-07-30' });
  });

  it('fevereiro de ano bissexto fecha no dia 29', () => {
    expect(intervaloDaVisao('mes', '2028-02-10')).toEqual({ de: '2028-02-01', ate: '2028-03-01' });
  });

  it('a grade do mês alinha o dia 1 na coluna certa e fecha semanas inteiras', () => {
    // 2026-07-01 é uma quarta → 2 células vazias antes (seg, ter)
    const celulas = celulasDoMes('2026-07-15');
    expect(celulas.slice(0, 2)).toEqual([null, null]);
    expect(celulas[2]).toBe('2026-07-01');
    expect(celulas.length % 7).toBe(0);
    expect(celulas.filter(Boolean)).toHaveLength(31);
  });

  it('somarDias atravessa a virada de mês sem escorregar de dia', () => {
    expect(somarDias('2026-07-31', 1)).toBe('2026-08-01');
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('o dia da consulta é lido no fuso LOCAL, não em UTC', () => {
    // 23:30 local continua sendo o mesmo dia na tela (em UTC já teria virado)
    const iso = paraIsoLocal('2026-07-29', '23:30');
    expect(diaLocalDe(iso)).toBe('2026-07-29');
  });

  it('os rótulos saem em português de gente', () => {
    expect(rotuloCurtoDoDia('2026-07-29')).toBe('qua 29/07');
    expect(rotuloDoMes('2026-07-29')).toBe('julho de 2026');
  });
});

function consulta(extra: Partial<AppointmentDoDia> = {}): AppointmentDoDia {
  return {
    id: 'appt-1',
    startsAt: paraIsoLocal('2026-07-29', '09:00'),
    endsAt: paraIsoLocal('2026-07-29', '09:30'),
    status: 'agendado',
    source: 'manual',
    professionalId: 'pro-a',
    contactName: 'Paciente Teste',
    contactPhone: null,
    professionalName: 'Dra. Ana',
    ...extra,
  } as AppointmentDoDia;
}

describe('AgendaGradeSemana', () => {
  it('mostra os 7 dias em colunas e a consulta no dia certo', () => {
    render(
      <AgendaGradeSemana
        appointments={[consulta()]}
        date="2026-07-29"
        professionalName="Dra. Ana"
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'seg 27/07' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'dom 02/08' })).toBeInTheDocument();
    expect(screen.getByText('Paciente Teste')).toBeInTheDocument();
  });

  it('a vaga livre diz o dia e a hora em linguagem de gente', () => {
    render(
      <AgendaGradeSemana
        appointments={[]}
        date="2026-07-29"
        professionalName="Dra. Ana"
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Marcar 09:00 de qua 29/07 com Dra. Ana' }),
    ).toBeInTheDocument();
  });

  it('consulta de 60 minutos ocupa DUAS linhas do mesmo dia', () => {
    render(
      <AgendaGradeSemana
        appointments={[consulta({ endsAt: paraIsoLocal('2026-07-29', '10:00') })]}
        date="2026-07-29"
        professionalName="Dra. Ana"
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Marcar 09:30 de qua 29/07 com Dra. Ana' }),
    ).not.toBeInTheDocument();
    // o mesmo horário no dia seguinte continua livre
    expect(
      screen.getByRole('button', { name: 'Marcar 09:30 de qui 30/07 com Dra. Ana' }),
    ).toBeInTheDocument();
  });

  it('cancelada não segura a vaga', () => {
    render(
      <AgendaGradeSemana
        appointments={[consulta({ status: 'cancelado', endsAt: paraIsoLocal('2026-07-29', '10:00') })]}
        date="2026-07-29"
        professionalName="Dra. Ana"
        onMarcar={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Marcar 09:30 de qua 29/07 com Dra. Ana' }),
    ).toBeInTheDocument();
  });
});

describe('AgendaGradeMes', () => {
  it('mostra a consulta no dia dela e leva pro dia ao clicar no número', async () => {
    const abrirDia = vi.fn();
    render(
      <AgendaGradeMes
        appointments={[consulta()]}
        date="2026-07-15"
        professionalName="Dra. Ana"
        onAbrirDia={abrirDia}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByText('Paciente Teste')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Abrir 2026-07-29 de Dra. Ana' }).click();
    expect(abrirDia).toHaveBeenCalledWith('2026-07-29');
  });

  it('acima de 3 consultas no mesmo dia, resume o resto em "+N" em vez de esconder', () => {
    const muitas = ['08:00', '08:30', '09:00', '09:30', '10:00'].map((hora, i) =>
      consulta({ id: `appt-${i}`, startsAt: paraIsoLocal('2026-07-29', hora), endsAt: null }),
    );
    render(
      <AgendaGradeMes
        appointments={muitas}
        date="2026-07-15"
        professionalName="Dra. Ana"
        onAbrirDia={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '+2 consultas' })).toBeInTheDocument();
  });

  it('uma consulta sobrando fala no singular', () => {
    const quatro = ['08:00', '08:30', '09:00', '09:30'].map((hora, i) =>
      consulta({ id: `appt-${i}`, startsAt: paraIsoLocal('2026-07-29', hora), endsAt: null }),
    );
    render(
      <AgendaGradeMes
        appointments={quatro}
        date="2026-07-15"
        professionalName="Dra. Ana"
        onAbrirDia={vi.fn()}
        onAbrirConsulta={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '+1 consulta' })).toBeInTheDocument();
  });
});
