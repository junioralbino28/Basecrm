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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_REGEX.test(value));
}

export function getTenantIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/platform\/tenants\/([^/]+)(?:\/|$)/);
  const candidate = match?.[1] ?? null;
  return isUuid(candidate) ? candidate : null;
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
  return getTenantIdFromPathname(pathname) !== null;
}

export function getTenantWorkspaceRelativeHref(pathname: string): string {
  const tenantId = getTenantIdFromPathname(pathname);
  if (!tenantId) return '/dashboard';
  const match = pathname.match(/^\/platform\/tenants\/[0-9a-f-]+(\/.*)?$/i);
  const relativePath = match?.[1] || '/dashboard';
  return relativePath === '/pipeline' ? '/boards' : relativePath;
}
