// Config do nudge (N3): select "aviso automático" no header da tela Tarefas.
// Gate por ROLE REAL (canManageClinicSettings) — staff não vê o controle;
// a RLS can_configure é quem barra de verdade no banco.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { axe } from '@/lib/a11y/test/a11y-utils';

let mockRole = 'clinic_admin';
const mutateNudge = vi.fn();
const showToast = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', role: mockRole, email: 'x@x.com', organization_id: 'org-1' },
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/lib/query/hooks/useOrganizationSettingsQuery', () => ({
  useTaskNudgeInterval: () => ({ data: 30, isLoading: false }),
  useUpdateTaskNudgeInterval: () => ({ mutate: mutateNudge, isPending: false }),
}));

import { TaskNudgeSettingsSelect } from './TaskNudgeSettingsSelect';

describe('TaskNudgeSettingsSelect (N3 — aviso automático)', () => {
  beforeEach(() => {
    mockRole = 'clinic_admin';
    mutateNudge.mockClear();
    showToast.mockClear();
  });

  it('clinic_staff NÃO vê o controle (gate por role real, sem classe responsiva)', () => {
    mockRole = 'clinic_staff';
    const { container } = render(<TaskNudgeSettingsSelect />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByLabelText(/aviso automático/i)).toBeNull();
  });

  it('clinic_admin vê o select com o valor salvo e as 4 opções do mockup', () => {
    render(<TaskNudgeSettingsSelect />);
    const select = screen.getByLabelText(/aviso automático/i) as HTMLSelectElement;
    expect(select.value).toBe('30');
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['a cada 15 min', 'a cada 30 min', 'a cada 1 h', 'desligado']);
  });

  it('mudar o intervalo dispara a mutation com o valor do domínio e toast no sucesso', async () => {
    const user = userEvent.setup();
    render(<TaskNudgeSettingsSelect />);

    await user.selectOptions(screen.getByLabelText(/aviso automático/i), '15');
    expect(mutateNudge).toHaveBeenCalledWith(15, expect.any(Object));

    const callbacks = mutateNudge.mock.calls[0][1];
    callbacks.onSuccess();
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/salvo/i), 'success');
  });

  it('desligar manda null e erro da mutation vira toast (regra: toast onError)', async () => {
    const user = userEvent.setup();
    render(<TaskNudgeSettingsSelect />);

    await user.selectOptions(screen.getByLabelText(/aviso automático/i), '');
    expect(mutateNudge).toHaveBeenCalledWith(null, expect.any(Object));

    const callbacks = mutateNudge.mock.calls[0][1];
    callbacks.onError(new Error('sem permissão'));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('sem permissão'), 'error');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<TaskNudgeSettingsSelect />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
