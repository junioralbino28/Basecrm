const TENANT_SCOPED_BASE_ROUTES = new Set([
  '/inbox',
  '/dashboard',
  '/boards',
  '/contacts',
  '/activities',
  '/reports',
  '/settings',
  '/pipeline',
]);

export function getTenantIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/platform\/tenants\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

export function getTenantWorkspaceHref(href: string, tenantId?: string | null): string {
  if (!tenantId) return href;

  const [pathWithQuery, hash = ''] = href.split('#');
  const [pathname, query = ''] = pathWithQuery.split('?');
  const normalizedPathname = pathname === '/pipeline' ? '/boards' : pathname;

  if (!TENANT_SCOPED_BASE_ROUTES.has(pathname) && !TENANT_SCOPED_BASE_ROUTES.has(normalizedPathname)) {
    return href;
  }

  const resolvedPathname = normalizedPathname === '/inbox'
    ? `/platform/tenants/${tenantId}/inbox`
    : `/platform/tenants/${tenantId}${normalizedPathname}`;

  return `${resolvedPathname}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

export function isTenantWorkspacePath(pathname: string): boolean {
  return /^\/platform\/tenants\/[^/]+(?:\/|$)/.test(pathname);
}

export function getTenantWorkspaceRelativeHref(pathname: string): string {
  const match = pathname.match(/^\/platform\/tenants\/[^/]+(\/.*)?$/);
  const relativePath = match?.[1] || '/dashboard';
  return relativePath === '/pipeline' ? '/boards' : relativePath;
}
