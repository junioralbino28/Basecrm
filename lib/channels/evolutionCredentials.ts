import { isAgencyAdminRole } from '@/lib/auth/scope';

type EvolutionConfigLike = {
  apiUrl?: unknown;
  apiKey?: unknown;
};

type ResolveEvolutionCredentialsParams = {
  admin: any;
  tenantId: string;
  connectionConfig?: EvolutionConfigLike | null;
  profileRole?: unknown;
  requesterOrganizationId?: string | null;
};

export type ResolvedEvolutionCredentials = {
  apiUrl: string;
  apiKey: string;
  source: 'connection' | 'agency_defaults';
  agencyOrganizationId: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readAgencyDefaults(metadata: unknown): { apiUrl: string; apiKey: string } {
  const map = (metadata || {}) as Record<string, unknown>;
  const nested = (map.evolutionDefaults || {}) as Record<string, unknown>;

  const apiUrl =
    normalizeText(nested.apiUrl) ||
    normalizeText(map.evolutionDefaultApiUrl) ||
    normalizeText(map.evolution_api_url);

  const apiKey =
    normalizeText(nested.apiKey) ||
    normalizeText(map.evolutionDefaultApiKey) ||
    normalizeText(map.evolution_api_key);

  return { apiUrl, apiKey };
}

export async function readTenantAgencyBinding(admin: any, tenantId: string) {
  const tenantEdition = await admin
    .from('organization_editions')
    .select('organization_id, metadata')
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (tenantEdition.error) throw new Error(tenantEdition.error.message);

  const tenantMetadata = ((tenantEdition.data?.metadata || {}) as Record<string, unknown>) || {};
  const agencyOrganizationId = normalizeText(tenantMetadata.agencyOrganizationId) || null;

  return {
    tenantMetadata,
    agencyOrganizationId,
  };
}

export async function ensureTenantAgencyBinding(params: {
  admin: any;
  tenantId: string;
  agencyOrganizationId: string;
}) {
  const current = await readTenantAgencyBinding(params.admin, params.tenantId);
  if (current.agencyOrganizationId === params.agencyOrganizationId) return;

  const nextMetadata = {
    ...current.tenantMetadata,
    agencyOrganizationId: params.agencyOrganizationId,
  };

  const updateResult = await params.admin
    .from('organization_editions')
    .upsert(
      {
        organization_id: params.tenantId,
        edition_key: 'clinic',
        metadata: nextMetadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' }
    );

  if (updateResult.error) throw new Error(updateResult.error.message);
}

export async function resolveEvolutionCredentials(
  params: ResolveEvolutionCredentialsParams
): Promise<ResolvedEvolutionCredentials | null> {
  const configApiUrl = normalizeText(params.connectionConfig?.apiUrl);
  const configApiKey = normalizeText(params.connectionConfig?.apiKey);

  if (configApiUrl && configApiKey) {
    return {
      apiUrl: configApiUrl,
      apiKey: configApiKey,
      source: 'connection',
      agencyOrganizationId: null,
    };
  }

  const binding = await readTenantAgencyBinding(params.admin, params.tenantId);
  const fallbackAgencyOrgId =
    isAgencyAdminRole(params.profileRole) && params.requesterOrganizationId && params.requesterOrganizationId !== params.tenantId
      ? params.requesterOrganizationId
      : null;

  const agencyOrganizationId = binding.agencyOrganizationId || fallbackAgencyOrgId;
  if (!agencyOrganizationId) {
    return null;
  }

  const agencyEdition = await params.admin
    .from('organization_editions')
    .select('organization_id, metadata')
    .eq('organization_id', agencyOrganizationId)
    .maybeSingle();

  if (agencyEdition.error) throw new Error(agencyEdition.error.message);

  const defaults = readAgencyDefaults(agencyEdition.data?.metadata);
  const apiUrl = configApiUrl || defaults.apiUrl;
  const apiKey = configApiKey || defaults.apiKey;

  if (!apiUrl || !apiKey) return null;

  return {
    apiUrl,
    apiKey,
    source: 'agency_defaults',
    agencyOrganizationId,
  };
}

