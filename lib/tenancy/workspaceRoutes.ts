/**
 * Toda rota que existe sob `app/(protected)/platform/tenants/[tenantId]/` precisa estar aqui.
 *
 * Quem lê esta lista e o `getTenantWorkspaceHref`, e e ele que remonta o caminho ao TROCAR DE
 * CLIENTE pelo seletor do cabecalho: estando em `/platform/tenants/<A>/conversations`, ele tira o
 * prefixo, acha `/conversations`, e devolve o caminho com o prefixo do cliente <B>. Se a rota
 * NAO esta nesta lista, ele devolve `/conversations` cru — e o `router.push` cai num 404, porque
 * essa rota so existe sob o tenant.
 *
 * Foi o que aconteceu em producao em 24/09/2026: o Junior trocou de cliente estando na tela de
 * Conversas e caiu em `crm.basea2.com/conversations` com "404 This page could not be found",
 * na Dra. Jessica e na FM Vistos. Faltavam SEIS rotas aqui, nao uma.
 *
 * `workspaceRoutes.test.ts` compara esta lista com as pastas em disco: rota nova sem entrada aqui
 * quebra o teste antes de chegar na tela.
 */
const TENANT_SCOPED_BASE_ROUTES = new Set([
  '/inbox',
  '/dashboard',
  '/visao-geral',
  '/boards',
  '/contacts',
  '/conversations',
  '/activities',
  '/call-list',
  '/tarefas',
  '/atendimentos',
  '/automations',
  '/agents',
  '/whatsapp',
  '/channels',
  '/domains',
  '/branding',
  '/reports',
  '/reports/financeiro',
  '/reports/profissionais',
  '/settings',
  '/pipeline',
]);

/**
 * Listas que têm tela de detalhe sob o cliente ('/agents' -> '/agents/<agentId>'). Uma lista só, usada pelo menu
 * (item aceso no detalhe: components/navigation/rotaAtiva.ts) e pela troca de cliente (getTenantWorkspaceRelativeHref).
 */
export const LISTAS_COM_DETALHE: readonly string[] = ['/agents'];

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

/**
 * Rotas de detalhe de um recurso do cliente ('/agents/<id>'): ao trocar de cliente, o id do recurso não existe no
 * outro, então o caminho volta para a lista. Sem isso o seletor remontava '/agents/<id>' no outro cliente: 404.
 */
export function getTenantWorkspaceRelativeHref(pathname: string): string {
  const tenantId = getTenantIdFromPathname(pathname);
  if (!tenantId) return '/dashboard';
  const match = pathname.match(/^\/platform\/tenants\/[0-9a-f-]+(\/.*)?$/i);
  const relativePath = match?.[1] || '/dashboard';
  const lista = LISTAS_COM_DETALHE.find((base) => relativePath.startsWith(`${base}/`));
  if (lista) return lista;
  return relativePath === '/pipeline' ? '/boards' : relativePath;
}
