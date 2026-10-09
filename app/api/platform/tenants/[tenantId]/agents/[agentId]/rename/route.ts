import { renomearAgente } from '@/lib/agents/editorAgentes';
import {
  LIMITE_DE_RENOMEAR_EXCLUIR_BYTES,
  RenomearSchema,
  abrirRotaDoAgente,
  json,
  lerCorpoLimitado,
  responderFalha,
} from '@/lib/agents/rotaDoEditor';

/** Renomeia o agente. Sem trava de revisão: se duas pessoas renomearem juntas, vale a última (SPEC-renomear-excluir.md). */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpoLimitado(req, RenomearSchema, LIMITE_DE_RENOMEAR_EXCLUIR_BYTES);
  if (!corpo.ok) return corpo.resposta;
  const r = await renomearAgente(aberta.clientes, { tenantId: aberta.tenantId, agentId: aberta.agentId, nome: corpo.corpo.nome });
  return r.ok ? json(r.dados) : responderFalha(r);
}
