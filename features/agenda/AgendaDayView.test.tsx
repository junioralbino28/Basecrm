import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '@/lib/a11y/test/a11y-utils';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u1', role: 'clinic_staff', organization_id: 'org-1', email: 'v@x.com' },
    user: { id: 'u1' },
    loading: false,
  }),
}));

import { AgendaDayView } from './components/AgendaDayView';

const professionals = [
  { id: 'p1', name: 'Dra. Jessica', specialty: 'Ortodontia', active: true, externalId: '222' },
];

const baseProps = {
  date: '2026-06-12',
  appointments: [
    { id: 'a1', startsAt: '2026-06-12T09:00:00', endsAt: '2026-06-12T10:00:00', status: 'agendado' as const, source: 'clinicorp_api' as const, externalId: '987', notes: 'Lucas · (47) 99999-9999' },
  ],
  availableSlots: [
    { From: '14:00', To: '15:00', Date: '2026-06-12', ProfessionalId: 222 },
  ],
  professionals,
  selectedProfessionalId: 'p1' as string | null,
  onSelectProfessional: vi.fn(),
  loading: false,
  error: null as string | null,
  onBookSlot: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AgendaDayView', () => {
  it('renderiza agendamentos do dia e slots livres', () => {
    render(<AgendaDayView {...baseProps} />);
    expect(screen.getByText(/Lucas/)).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /14:00.*agendar|agendar.*14:00/i })).toBeInTheDocument();
  });

  it('aciona onBookSlot ao clicar num slot livre', async () => {
    render(<AgendaDayView {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: /14:00/i }));
    expect(baseProps.onBookSlot).toHaveBeenCalledWith(baseProps.availableSlots[0]);
  });

  it('aciona onSelectProfessional ao escolher um dentista', async () => {
    render(<AgendaDayView {...baseProps} selectedProfessionalId={null} appointments={[]} availableSlots={[]} />);
    await userEvent.selectOptions(screen.getByLabelText(/dentista da agenda/i), 'p1');
    expect(baseProps.onSelectProfessional).toHaveBeenCalledWith('p1');
  });

  it('pede para escolher dentista quando nenhum está selecionado', () => {
    render(<AgendaDayView {...baseProps} selectedProfessionalId={null} appointments={[]} availableSlots={[]} />);
    expect(screen.getByText(/escolha um dentista/i)).toBeInTheDocument();
  });

  it('mostra estado de carregamento', () => {
    render(<AgendaDayView {...baseProps} appointments={[]} availableSlots={[]} loading />);
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  it('mostra erro quando a integração falha', () => {
    render(<AgendaDayView {...baseProps} appointments={[]} availableSlots={[]} error="Integração Clinicorp não configurada para esta clínica." />);
    expect(screen.getByText(/clinicorp não configurada/i)).toBeInTheDocument();
  });

  it('mostra empty quando não há agendamentos nem slots', () => {
    render(<AgendaDayView {...baseProps} appointments={[]} availableSlots={[]} />);
    expect(screen.getByText(/nenhum horário|sem agendamentos/i)).toBeInTheDocument();
  });

  it('sem violações de acessibilidade', async () => {
    const { container } = render(<AgendaDayView {...baseProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
