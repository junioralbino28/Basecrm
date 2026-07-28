import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();
vi.mock('./client', () => ({
  supabase: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { appointmentsLocalService } from './appointmentsLocal';

/**
 * Agenda NOSSA — fatia 1: as marcações criadas pela tela nascem `source:
 * 'manual'` e `status: 'agendado'` no NOSSO banco. Nada toca o Clinicorp.
 */
type Chain = Record<string, unknown>;
function chain(data: unknown, error: unknown = null): Chain {
  const c: Chain = {};
  const self = () => c;
  for (const m of ['select', 'eq', 'gte', 'lt', 'order', 'insert', 'update']) {
    c[m] = vi.fn(self);
  }
  c.single = vi.fn(async () => ({ data, error }));
  c.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => resolve({ data, error });
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe('appointmentsLocalService', () => {
  it('criar grava source manual e status agendado (nada de Clinicorp na fatia 1)', async () => {
    const c = chain({ id: 'nova' });
    fromMock.mockReturnValue(c);

    const { error } = await appointmentsLocalService.criar({
      organizationId: 'org-1',
      contactId: 'contato-1',
      professionalId: 'pro-1',
      startsAtIso: '2026-07-28T12:00:00.000Z',
      endsAtIso: '2026-07-28T12:30:00.000Z',
      notes: '  avaliação  ',
    });

    expect(error).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('appointments');
    expect(c.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'manual',
        status: 'agendado',
        organization_id: 'org-1',
        notes: 'avaliação',
      }),
    );
  });

  it('remarcar carimba o status remarcado e mantém o resto', async () => {
    const c = chain(null);
    fromMock.mockReturnValue(c);

    await appointmentsLocalService.remarcar('appt-1', {
      startsAtIso: '2026-07-29T13:00:00.000Z',
      endsAtIso: '2026-07-29T14:00:00.000Z',
      professionalId: 'pro-2',
    });

    expect(c.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'remarcado', professional_id: 'pro-2' }),
    );
    expect(c.eq).toHaveBeenCalledWith('id', 'appt-1');
  });

  it('listar normaliza o embed (objeto OU array) pra nome de contato e dentista', async () => {
    const linhas = [
      {
        id: 'a1', organization_id: 'org-1', contact_id: 'c1', professional_id: 'p1',
        starts_at: '2026-07-28T12:00:00.000Z', ends_at: null, status: 'agendado',
        source: 'manual', external_id: null, notes: null,
        contacts: [{ name: 'Maria', phone: '21999' }],
        professionals: { name: 'Dra. Ana' },
      },
    ];
    fromMock.mockReturnValue(chain(linhas));

    const { data, error } = await appointmentsLocalService.listar('org-1', 'de', 'ate');

    expect(error).toBeNull();
    expect(data[0].contactName).toBe('Maria');
    expect(data[0].professionalName).toBe('Dra. Ana');
  });
});
