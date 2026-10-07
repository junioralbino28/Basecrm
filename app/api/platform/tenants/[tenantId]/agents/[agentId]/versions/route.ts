import { listarVersoes } from '@/lib/agents/editorAgentes';
import { ConsultaDoHistorico, abrirRotaDoAgente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/**
 * Histórico do agente, uma página por vez, da mais nova para a mais antiga (sem o texto; a comparação lê cada
 * versão). `?antesDe=N` traz a página seguinte. Devolve `{ versoes, temMais }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const consulta = ConsultaDoHistorico.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!consulta.success) return json({ error: 'Pedido inválido.' }, 400);
  const r = await listarVersoes(aberta.clientes, aberta.tenantId, aberta.agentId, { antesDe: consulta.data.antesDe });
  return r.ok ? json(r.dados) : responderFalha(r);
}
