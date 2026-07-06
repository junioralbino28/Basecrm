import { z } from 'zod';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { assertInstallerAllowed } from '@/lib/installer/guard';
import {
  findProjectByDomain,
  getProject,
  validateVercelToken,
} from '@/lib/installer/vercel';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const BootstrapSchema = z
  .object({
    installerToken: z.string().optional(),
    token: z.string().min(1),
    domain: z.string().optional(),
  })
  .strict();

/**
 * Handler HTTP `POST` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const raw = await req.json().catch(() => null);
  const parsed = BootstrapSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const installerGuard = assertInstallerAllowed({
    requireToken: true,
    providedToken: parsed.data.installerToken,
  });
  if (!installerGuard.ok) {
    return json({ error: installerGuard.error }, installerGuard.status);
  }

  const tokenResult = await validateVercelToken(parsed.data.token);
  if (!tokenResult.ok) {
    return json({ error: tokenResult.error }, 401);
  }

  const envProjectId = process.env.VERCEL_PROJECT_ID || '';
  const envOrgId = process.env.VERCEL_ORG_ID || '';
  const envTeamId = envOrgId && envOrgId !== tokenResult.userId ? envOrgId : undefined;

  let projectResult:
    | { ok: true; project: { id: string; name: string; accountId?: string; alias?: { domain: string }[]; targets?: { production?: { alias?: string[] } } } }
    | { ok: false; error: string }
    | undefined;

  if (envProjectId) {
    projectResult = await getProject(parsed.data.token, envProjectId, envTeamId);
  }

  if (!projectResult || !projectResult.ok) {
    const host =
      parsed.data.domain ||
      req.headers.get('x-forwarded-host') ||
      req.headers.get('host') ||
      '';
    if (!host) {
      return json({ error: 'Missing domain for project detection' }, 400);
    }
    projectResult = await findProjectByDomain(parsed.data.token, host);
  }

  if (!projectResult || !projectResult.ok) {
    return json({ error: projectResult.error || 'Project not found' }, 404);
  }

  const project = projectResult.project;
  const productionAliases = project.targets?.production?.alias || [];
  const projectAliases = project.alias?.map((a) => a.domain) || [];
  const allAliases = [...productionAliases, ...projectAliases];

  const primaryUrl =
    allAliases.find((alias) => alias.endsWith('.vercel.app')) ||
    allAliases[0] ||
    `${project.name}.vercel.app`;

  const rawTeamId = project.accountId || envOrgId || undefined;
  const teamId = rawTeamId && rawTeamId !== tokenResult.userId ? rawTeamId : undefined;

  return json({
    success: true,
    project: {
      id: project.id,
      name: project.name,
      teamId,
      url: primaryUrl,
    },
  });
}
