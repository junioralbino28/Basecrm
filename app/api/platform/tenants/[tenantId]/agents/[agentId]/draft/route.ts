import { salvarRascunho } from '@/lib/agents/editorAgentes';
import { RascunhoSchema, abrirRotaDoAgente, json, lerCorpo, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Salva o rascunho com a revisão que a tela leu; se outra aba salvou antes, 409 em vez de sobrescrever. */
export async function PUT(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpo(req, RascunhoSchema);
  if (!corpo.ok) return corpo.resposta;
  const r = await salvarRascunho(aberta.clientes, {
    tenantId: aberta.tenantId,
    agentId: aberta.agentId,
    revisao: corpo.corpo.revisao,
    prompt: corpo.corpo.prompt,
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
