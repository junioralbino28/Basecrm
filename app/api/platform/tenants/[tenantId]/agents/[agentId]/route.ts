import { lerAgente } from '@/lib/agents/editorAgentes';
import { abrirRotaDoAgente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/** O agente para o editor: versão publicada completa, rascunho e números ligados (sem a config deles). */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const r = await lerAgente(aberta.clientes, aberta.tenantId, aberta.agentId);
  return r.ok ? json({ agente: r.dados }) : responderFalha(r);
}
