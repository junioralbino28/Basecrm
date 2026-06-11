import { describe, expect, it, vi } from 'vitest';
import { resolveClinicorpCredentials } from './clinicorpCredentials';

function adminWithRow(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
        }),
      }),
    }),
  };
}

describe('resolveClinicorpCredentials', () => {
  it('resolve as credenciais do tenant a partir de clinicorp_config', async () => {
    const admin = adminWithRow({
      api_user: 'apiuser',
      api_token: 'secret-token',
      subscriber_id: 'sub-123',
      code_link: '4567',
      business_id: 111,
    });

    const resolved = await resolveClinicorpCredentials({ admin, tenantId: 'org-1' });

    expect(resolved).toEqual({
      apiUrl: 'https://api.clinicorp.com/rest/v1',
      apiUser: 'apiuser',
      apiToken: 'secret-token',
      subscriberId: 'sub-123',
      codeLink: '4567',
      businessId: 111,
    });
    expect(admin.from).toHaveBeenCalledWith('clinicorp_config');
  });

  it('resolve SEM code_link (clínica piloto não usa agendamento online)', async () => {
    const admin = adminWithRow({
      api_user: 'apiuser',
      api_token: 'secret-token',
      subscriber_id: 'sub-123',
      code_link: '',
      business_id: 111,
    });

    const resolved = await resolveClinicorpCredentials({ admin, tenantId: 'org-1' });

    expect(resolved).toEqual({
      apiUrl: 'https://api.clinicorp.com/rest/v1',
      apiUser: 'apiuser',
      apiToken: 'secret-token',
      subscriberId: 'sub-123',
      businessId: 111,
    });
    // codeLink ausente (não vazio) — nada de chave fantasma no objeto resolvido.
    expect(resolved && 'codeLink' in resolved).toBe(false);
  });

  it('retorna null quando a config está incompleta (sem subscriber_id)', async () => {
    const admin = adminWithRow({ api_user: 'u', api_token: 't', subscriber_id: '', code_link: '4567', business_id: 111 });
    const resolved = await resolveClinicorpCredentials({ admin, tenantId: 'org-1' });
    expect(resolved).toBeNull();
  });

  it('retorna null quando não há linha de config', async () => {
    const admin = adminWithRow(null);
    const resolved = await resolveClinicorpCredentials({ admin, tenantId: 'org-1' });
    expect(resolved).toBeNull();
  });

  it('lança quando o supabase retorna erro', async () => {
    const admin = adminWithRow(null, { message: 'boom' });
    await expect(resolveClinicorpCredentials({ admin, tenantId: 'org-1' })).rejects.toThrow('boom');
  });
});
