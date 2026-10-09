import 'server-only';
import { isAgencyAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import type { Clientes } from './editorAgentes';
import { json } from './rotaDoEditor';

/**
 * Porta das rotas de nível agência da Central de Agentes (bloco 2: a biblioteca de modelos). Mesmo padrão do
 * `requireAgencyAdminProfile` de app/api/platform/agency/evolution/route.ts, num lugar só. Na ordem: origem HTTP (toda
 * rota que escreve, antes de qualquer outra coisa; rodada 1 do Codex na SPEC, achado 2), sessão, papel
 * (agency_admin e o legado admin) e os dois clientes: o do usuário (lê pela RLS e escreve pelas funções) e o de
 * serviço, só para ler nomes de pessoas.
 */
export async function abrirRotaDaAgencia(
  req: Request,
  opcoes: { escreve: boolean },
): Promise<{ ok: true; clientes: Clientes } | { ok: false; resposta: Response }> {
  if (opcoes.escreve && !isAllowedOrigin(req)) return { ok: false, resposta: json({ error: 'Forbidden' }, 403) };
  const usuario = await createClient();
  const {
    data: { user },
  } = await usuario.auth.getUser();
  if (!user) return { ok: false, resposta: json({ error: 'Unauthorized' }, 401) };
  const { data: perfil } = await usuario.from('profiles').select('id, role').eq('id', user.id).maybeSingle();
  if (!perfil || !isAgencyAdminRole(normalizeAppUserRole(perfil.role))) {
    return { ok: false, resposta: json({ error: 'Forbidden' }, 403) };
  }
  return { ok: true, clientes: { usuario, admin: createStaticAdminClient() } };
}
