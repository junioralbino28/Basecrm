import { listarAgentes } from '@/lib/agents/editorAgentes';
import { abrirRotaDoCliente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Central de Agentes, fatia 2: os agentes do cliente. Só agência. */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const aberta = await abrirRotaDoCliente(req, await ctx.params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const r = await listarAgentes(aberta.clientes, aberta.tenantId);
  return r.ok ? json(r.dados) : responderFalha(r);
}
