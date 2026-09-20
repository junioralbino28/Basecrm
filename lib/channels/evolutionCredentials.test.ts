// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveEvolutionCredentials } from './evolutionCredentials';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENCY = '22222222-2222-4222-8222-222222222222';
const OTHER_AGENCY = '33333333-3333-4333-8333-333333333333';

/** Cliente admin falso: só o caminho `organization_editions` → select → eq(organization_id) → maybeSingle. */
function fakeAdmin(editions: Record<string, Record<string, unknown> | undefined>) {
  return {
    from: (table: string) => {
      if (table !== 'organization_editions') throw new Error(`tabela inesperada: ${table}`);
      return {
        select: () => ({
          eq: (_column: string, id: string) => ({
            maybeSingle: async () => ({
              data: editions[id] ? { organization_id: id, metadata: editions[id] } : null,
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

const agencyDefaults = { evolutionDefaults: { apiUrl: 'https://agencia.example.com', apiKey: 'CHAVE-AGENCIA' } };
const boundTenant = { agencyOrganizationId: AGENCY };

describe('resolveEvolutionCredentials — nunca misturar URL de uma fonte com chave de outra (B7)', () => {
  it('par completo na conexão vence e não consulta a agência', async () => {
    const admin = fakeAdmin({});
    const resolved = await resolveEvolutionCredentials({
      admin,
      tenantId: TENANT,
      connectionConfig: { apiUrl: 'https://propria.example.com', apiKey: 'CHAVE-PROPRIA' },
    });
    expect(resolved).toEqual({
      apiUrl: 'https://propria.example.com',
      apiKey: 'CHAVE-PROPRIA',
      source: 'connection',
      agencyOrganizationId: null,
    });
  });

  it('só apiUrl na conexão: a URL do tenant é IGNORADA e o par da agência é usado inteiro', async () => {
    const admin = fakeAdmin({ [TENANT]: boundTenant, [AGENCY]: agencyDefaults });
    const resolved = await resolveEvolutionCredentials({
      admin,
      tenantId: TENANT,
      connectionConfig: { apiUrl: 'https://host-do-atacante.example' },
    });
    expect(resolved).toEqual({
      apiUrl: 'https://agencia.example.com',
      apiKey: 'CHAVE-AGENCIA',
      source: 'agency_defaults',
      agencyOrganizationId: AGENCY,
    });
  });

  it('só apiKey na conexão: a chave do tenant é ignorada e o par da agência é usado inteiro', async () => {
    const admin = fakeAdmin({ [TENANT]: boundTenant, [AGENCY]: agencyDefaults });
    const resolved = await resolveEvolutionCredentials({
      admin,
      tenantId: TENANT,
      connectionConfig: { apiKey: 'CHAVE-SOLTA' },
    });
    expect(resolved?.apiUrl).toBe('https://agencia.example.com');
    expect(resolved?.apiKey).toBe('CHAVE-AGENCIA');
    expect(resolved?.source).toBe('agency_defaults');
  });

  it('par parcial + agência sem chave: devolve null em vez de completar com a URL do tenant', async () => {
    const admin = fakeAdmin({
      [TENANT]: boundTenant,
      [AGENCY]: { evolutionDefaults: { apiUrl: 'https://agencia.example.com', apiKey: '' } },
    });
    const resolved = await resolveEvolutionCredentials({
      admin,
      tenantId: TENANT,
      connectionConfig: { apiUrl: 'https://host-do-atacante.example' },
    });
    expect(resolved).toBeNull();
  });

  it('sem vínculo com agência e sem par completo: null', async () => {
    const admin = fakeAdmin({ [AGENCY]: agencyDefaults });
    const resolved = await resolveEvolutionCredentials({ admin, tenantId: TENANT, connectionConfig: {} });
    expect(resolved).toBeNull();
  });

  it('sem vínculo gravado, admin da agência que está operando serve de agência de fallback', async () => {
    const admin = fakeAdmin({ [OTHER_AGENCY]: agencyDefaults });
    const resolved = await resolveEvolutionCredentials({
      admin,
      tenantId: TENANT,
      connectionConfig: { apiUrl: 'https://host-do-atacante.example' },
      profileRole: 'agency_admin',
      requesterOrganizationId: OTHER_AGENCY,
    });
    expect(resolved?.apiUrl).toBe('https://agencia.example.com');
    expect(resolved?.agencyOrganizationId).toBe(OTHER_AGENCY);
  });

  it('organização sem agência acima usa o par completo da PRÓPRIA edição (a agência conectando o número dela)', async () => {
    const admin = fakeAdmin({ [TENANT]: agencyDefaults });
    const resolved = await resolveEvolutionCredentials({ admin, tenantId: TENANT, connectionConfig: {} });
    expect(resolved).toEqual({
      apiUrl: 'https://agencia.example.com',
      apiKey: 'CHAVE-AGENCIA',
      source: 'agency_defaults',
      agencyOrganizationId: TENANT,
    });
  });

  it('organização sem agência acima com par próprio incompleto: null', async () => {
    const admin = fakeAdmin({ [TENANT]: { evolutionDefaults: { apiUrl: 'https://agencia.example.com', apiKey: '' } } });
    expect(await resolveEvolutionCredentials({ admin, tenantId: TENANT, connectionConfig: {} })).toBeNull();
  });

  it('tenant vinculado a uma agência sem chave NÃO cai no par próprio', async () => {
    const admin = fakeAdmin({
      [TENANT]: { ...boundTenant, ...agencyDefaults },
      [AGENCY]: { evolutionDefaults: { apiUrl: 'https://agencia.example.com', apiKey: '' } },
    });
    expect(await resolveEvolutionCredentials({ admin, tenantId: TENANT, connectionConfig: {} })).toBeNull();
  });

  it('aceita as chaves legadas de defaults da agência', async () => {
    const admin = fakeAdmin({
      [TENANT]: boundTenant,
      [AGENCY]: { evolutionDefaultApiUrl: 'https://legado.example.com', evolutionDefaultApiKey: 'LEGADA' },
    });
    const resolved = await resolveEvolutionCredentials({ admin, tenantId: TENANT, connectionConfig: null });
    expect(resolved).toMatchObject({ apiUrl: 'https://legado.example.com', apiKey: 'LEGADA' });
  });
});
