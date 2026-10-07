import { restaurarVersao } from '@/lib/agents/editorAgentes';
import { RestaurarSchema, abrirRotaDoAgente, json, lerCorpo, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Restaura: publica o conteúdo da versão escolhida como versão nova e traz o texto dela para o rascunho. */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpo(req, RestaurarSchema);
  if (!corpo.ok) return corpo.resposta;
  const r = await restaurarVersao(aberta.clientes, {
    tenantId: aberta.tenantId,
    agentId: aberta.agentId,
    versao: corpo.corpo.versao,
    versaoEsperada: corpo.corpo.versaoEsperada,
    revisao: corpo.corpo.revisao,
    nota: corpo.corpo.nota?.trim() || null,
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
