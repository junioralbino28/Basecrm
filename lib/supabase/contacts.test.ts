import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('./client', () => ({
  supabase: { rpc },
}));

import { contactsService } from './contacts';

describe('contactsService.getStageCounts', () => {
  const organizationId = '10000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    rpc.mockReset();
  });

  it('chama somente a RPC tenantizada e transforma as linhas em mapa', async () => {
    rpc.mockResolvedValue({
      data: [
        { stage: 'LEAD', count: 2 },
        { stage: 'UNKNOWN', count: 1 },
      ],
      error: null,
    });

    const result = await contactsService.getStageCounts(organizationId);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_contact_stage_counts', {
      p_organization_id: organizationId,
    });
    expect(result).toEqual({
      data: { LEAD: 2, UNKNOWN: 1 },
      error: null,
    });
  });

  it.each([undefined, null, '', 'não-é-uuid'])(
    'recusa organizationId ausente ou inválido (%s) antes do PostgREST',
    async (invalidOrganizationId) => {
      const result = await contactsService.getStageCounts(
        invalidOrganizationId as unknown as string,
      );

      expect(rpc).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error?.message).toMatch(/organização válida/i);
    },
  );

  it('propaga erro retornado pela RPC sem tentar a assinatura legada', async () => {
    const rpcError = new Error('falha tenantizada');
    rpc.mockResolvedValue({ data: null, error: rpcError });

    const result = await contactsService.getStageCounts(organizationId);

    expect(result).toEqual({ data: null, error: rpcError });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
