import { generateAgentReplyPreview } from '@/lib/agents/testeDoAgente';
import {
  LIMITE_DO_TESTE_BYTES,
  TesteSchema,
  abrirRotaDoAgente,
  consumirLimitesDeTeste,
  contarFalhaDoProvedor,
  json,
  lerCorpoLimitado,
  responderFalha,
} from '@/lib/agents/rotaDoEditor';

export const maxDuration = 60;

/**
 * Testa o rascunho numa conversa simulada. Nada é enviado, gravado ou agendado (SPEC, fatia 3; D13): a única escrita
 * é a contagem dos limites. `escreve: true` porque é POST com custo, e a origem é conferida como nas rotas de escrita.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpoLimitado(req, TesteSchema, LIMITE_DO_TESTE_BYTES);
  if (!corpo.ok) return corpo.resposta;
  const limite = await consumirLimitesDeTeste(aberta.clientes.admin, aberta.usuarioId, aberta.tenantId);
  if (limite) return limite;
  const r = await generateAgentReplyPreview(aberta.clientes, { tenantId: aberta.tenantId, agentId: aberta.agentId, ...corpo.corpo });
  await contarFalhaDoProvedor(aberta.clientes.admin, aberta.tenantId, r);
  return r.ok ? json(r.dados) : responderFalha(r);
}
