import 'server-only';
import { z } from 'zod';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import type { Clientes, Falha } from './editorAgentes';

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Uuid = z.string().uuid();
export const NumeroDaVersao = z.coerce.number().int().min(1).max(1_000_000);

/** Consulta do histórico (G5/G19): só `antesDe`, para pedir a página seguinte; outro parâmetro é 400. */
export const ConsultaDoHistorico = z.object({ antesDe: NumeroDaVersao.optional() }).strict();

/** Corpos aceitos (G5/G19): campo fora da lista é 400, nunca ignorado. O autor nunca vem do corpo. */
export const RascunhoSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  revisao: z.number().int().min(0),
}).strict();

export const PublicarSchema = z.object({
  versaoEsperada: z.number().int().min(0),
  revisao: z.number().int().min(0),
  nota: z.string().max(200).optional(),
  confirmarAvisos: z.array(z.string().min(1).max(120)).max(50).optional(),
}).strict();

export const RestaurarSchema = z.object({
  versao: z.number().int().min(1),
  versaoEsperada: z.number().int().min(0),
  revisao: z.number().int().min(0),
  nota: z.string().max(200).optional(),
}).strict();

type Recusa = { ok: false; resposta: Response };
const recusa = (body: unknown, status: number): Recusa => ({ ok: false, resposta: json(body, status) });

/**
 * Porta das rotas da Central de Agentes (G3). Na ordem: origem (só nas que escrevem), id do cliente válido,
 * requireTenantAccess com adminOnly (agency_admin e o legado admin; agency_staff e o cliente recebem 403) e os dois
 * clientes do Supabase: o do usuário (JWT) para ler pela RLS e escrever pelas funções, e o de serviço só para leitura.
 */
export async function abrirRotaDoCliente(
  req: Request,
  params: { tenantId: string },
  opcoes: { escreve: boolean },
): Promise<{ ok: true; tenantId: string; clientes: Clientes } | Recusa> {
  if (opcoes.escreve && !isAllowedOrigin(req)) return recusa({ error: 'Forbidden' }, 403);
  if (!Uuid.safeParse(params.tenantId).success) return recusa({ error: 'Endereço inválido.' }, 400);
  const auth = await requireTenantAccess(params.tenantId, { adminOnly: true });
  // `'error' in auth` não estreita aqui: o TypeScript normaliza a união do retorno (error?: undefined no sucesso).
  if (auth.error) return { ok: false, resposta: auth.error };
  return { ok: true, tenantId: params.tenantId, clientes: { usuario: await createClient(), admin: createStaticAdminClient() } };
}

export async function abrirRotaDoAgente(
  req: Request,
  params: { tenantId: string; agentId: string },
  opcoes: { escreve: boolean },
): Promise<{ ok: true; tenantId: string; agentId: string; clientes: Clientes } | Recusa> {
  if (!Uuid.safeParse(params.agentId).success) return recusa({ error: 'Endereço inválido.' }, 400);
  const aberta = await abrirRotaDoCliente(req, params, opcoes);
  if (!aberta.ok) return aberta;
  return { ...aberta, agentId: params.agentId };
}

export async function lerCorpo<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; corpo: T } | Recusa> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recusa({ error: 'Pedido inválido.', details: parsed.error.flatten() }, 400);
  return { ok: true, corpo: parsed.data };
}

export function responderFalha(f: Falha) {
  return json({ error: f.erro, code: f.codigo, ...(f.verificacao ? { verificacao: f.verificacao } : {}) }, f.status);
}
