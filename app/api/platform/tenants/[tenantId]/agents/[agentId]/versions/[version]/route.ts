import { lerVersao } from '@/lib/agents/editorAgentes';
import { NumeroDaVersao, abrirRotaDoAgente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Uma versão inteira (texto, ajustes e modelo), para comparar e restaurar. */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string; version: string }> }) {
  const params = await ctx.params;
  const aberta = await abrirRotaDoAgente(req, params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const numero = NumeroDaVersao.safeParse(params.version);
  if (!numero.success) return json({ error: 'Versão inválida.' }, 400);
  const r = await lerVersao(aberta.clientes, aberta.tenantId, aberta.agentId, numero.data);
  return r.ok ? json({ versao: r.dados }) : responderFalha(r);
}
