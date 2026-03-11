import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

function normalizeHost(host: string | null | undefined) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

export async function resolveTenantByOrganizationId(params: {
  supabase: SupabaseClient;
  organizationId?: string | null;
  host?: string | null;
  source?: 'selected' | 'profile_fallback';
}) {
  if (!params.organizationId) return null;

  const { data: orgRow, error } = await params.supabase
    .from('organizations')
    .select(`
      id,
      name,
      organization_editions(edition_key, branding_config, enabled_modules)
    `)
    .eq('id', params.organizationId)
    .maybeSingle();

  if (error || !orgRow) return null;

  const edition = Array.isArray((orgRow as any).organization_editions)
    ? (orgRow as any).organization_editions[0]
    : (orgRow as any).organization_editions;

  return {
    organizationId: orgRow.id as string,
    organizationName: orgRow.name as string,
    host: normalizeHost(params.host) || null,
    editionKey: edition?.edition_key || null,
    brandingConfig: edition?.branding_config || {},
    enabledModules: edition?.enabled_modules || [],
    source: (params.source || 'profile_fallback') as 'selected' | 'profile_fallback',
  };
}

export async function resolveTenantByHost(params: {
  supabase: SupabaseClient;
  host?: string | null;
  fallbackOrganizationId?: string | null;
}) {
  const normalizedHost = normalizeHost(params.host);

  if (normalizedHost && normalizedHost !== 'localhost' && normalizedHost !== '127.0.0.1') {
    const { data: domainRow, error } = await params.supabase
      .from('organization_domains')
      .select(`
        organization_id,
        host,
        is_primary,
        status,
        organizations(
          id,
          name,
          organization_editions(edition_key, branding_config, enabled_modules)
        )
      `)
      .eq('host', normalizedHost)
      .eq('status', 'active')
      .maybeSingle();

    if (!error && domainRow?.organizations) {
      const edition = Array.isArray((domainRow.organizations as any).organization_editions)
        ? (domainRow.organizations as any).organization_editions[0]
        : (domainRow.organizations as any).organization_editions;

      return {
        organizationId: (domainRow.organizations as any).id as string,
        organizationName: (domainRow.organizations as any).name as string,
        host: normalizedHost,
        editionKey: edition?.edition_key || null,
        brandingConfig: edition?.branding_config || {},
        enabledModules: edition?.enabled_modules || [],
        source: 'domain' as const,
      };
    }
  }

  const fallbackTenant = await resolveTenantByOrganizationId({
    supabase: params.supabase,
    organizationId: params.fallbackOrganizationId,
    host: normalizedHost || null,
    source: 'profile_fallback',
  });

  if (fallbackTenant) return fallbackTenant;

  return null;
}
