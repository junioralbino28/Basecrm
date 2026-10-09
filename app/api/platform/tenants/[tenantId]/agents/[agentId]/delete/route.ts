import { excluirAgente } from '@/lib/agents/editorAgentes';
import { ExcluirSchema, abrirRotaDoAgente, json, lerCorpo, responderFalha } from '@/lib/agents/rotaDoEditor';

/**
 * Exclui o agente de vez (decisão do Junior, 09/10). O corpo traz o estado que a tela mostrou; se mudou, 409 e nada sai.
 * Agente com número ligado: 409. O registro da exclusão é gravado pelo banco, na mesma transação.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpo(req, ExcluirSchema);
  if (!corpo.ok) return corpo.resposta;
  const r = await excluirAgente(aberta.clientes, {
    tenantId: aberta.tenantId,
    agentId: aberta.agentId,
    nomeEsperado: corpo.corpo.nomeEsperado,
    revisaoEsperada: corpo.corpo.revisaoEsperada,
    versaoPublicadaEsperada: corpo.corpo.versaoPublicadaEsperada,
  });
  return r.ok ? json({ excluido: true, versoesExcluidas: r.dados.versoesExcluidas }) : responderFalha(r);
}
