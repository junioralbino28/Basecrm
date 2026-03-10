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

  if (params.fallbackOrganizationId) {
    const { data: orgRow, error } = await params.supabase
      .from('organizations')
      .select(`
        id,
        name,
        organization_editions(edition_key, branding_config, enabled_modules)
      `)
      .eq('id', params.fallbackOrganizationId)
      .maybeSingle();

    if (!error && orgRow) {
      const edition = Array.isArray((orgRow as any).organization_editions)
        ? (orgRow as any).organization_editions[0]
        : (orgRow as any).organization_editions;

      return {
        organizationId: orgRow.id as string,
        organizationName: orgRow.name as string,
        host: normalizedHost || null,
        editionKey: edition?.edition_key || null,
        brandingConfig: edition?.branding_config || {},
        enabledModules: edition?.enabled_modules || [],
        source: 'profile_fallback' as const,
      };
    }
  }

  return null;
}
