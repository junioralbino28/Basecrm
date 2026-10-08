import { explicarRespostaDoTeste } from '@/lib/agents/testeDoAgente';
import {
  ExplicarSchema,
  LIMITE_DA_EXPLICACAO_BYTES,
  abrirRotaDoAgente,
  consumirLimitesDeTeste,
  contarFalhaDoProvedor,
  json,
  lerCorpoLimitado,
  responderFalha,
} from '@/lib/agents/rotaDoEditor';

export const maxDuration = 60;

/**
 * Explica uma resposta do teste a partir do retrato assinado pelo servidor (D7): o prompt e o modelo que a explicação
 * usa são os que o teste usou, conferidos pela assinatura. Conta nos mesmos três limites do teste (D6).
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpoLimitado(req, ExplicarSchema, LIMITE_DA_EXPLICACAO_BYTES);
  if (!corpo.ok) return corpo.resposta;
  const limite = await consumirLimitesDeTeste(aberta.clientes.admin, aberta.usuarioId, aberta.tenantId);
  if (limite) return limite;
  const r = await explicarRespostaDoTeste(aberta.clientes, { tenantId: aberta.tenantId, agentId: aberta.agentId, ...corpo.corpo });
  await contarFalhaDoProvedor(aberta.clientes.admin, aberta.tenantId, r);
  return r.ok ? json(r.dados) : responderFalha(r);
}
