import { publicarComVerificacao } from '@/lib/agents/editorAgentes';
import { PublicarSchema, abrirRotaDoAgente, json, lerCorpo, responderFalha } from '@/lib/agents/rotaDoEditor';

/**
 * Publica o rascunho gravado como versão N+1. A verificação ao vivo roda de novo aqui; aviso só passa confirmado
 * (422 com a verificação). Versão publicada ou revisão diferentes das que a tela mostrou: 409, e a tela recarrega.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpo(req, PublicarSchema);
  if (!corpo.ok) return corpo.resposta;
  const r = await publicarComVerificacao(aberta.clientes, {
    tenantId: aberta.tenantId,
    agentId: aberta.agentId,
    versaoEsperada: corpo.corpo.versaoEsperada,
    revisao: corpo.corpo.revisao,
    nota: corpo.corpo.nota?.trim() || null,
    confirmarAvisos: corpo.corpo.confirmarAvisos ?? [],
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
