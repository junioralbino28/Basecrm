import { listarAgentes } from '@/lib/agents/editorAgentes';
import { criarAgente } from '@/lib/agents/modelosAgentes';
import {
  CriarAgenteSchema,
  LIMITE_DO_MODELO_BYTES,
  abrirRotaDoCliente,
  json,
  lerCorpoLimitado,
  responderFalha,
} from '@/lib/agents/rotaDoEditor';

/** Central de Agentes, fatia 2: os agentes do cliente. Só agência. */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const aberta = await abrirRotaDoCliente(req, await ctx.params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const r = await listarAgentes(aberta.clientes, aberta.tenantId);
  return r.ok ? json(r.dados) : responderFalha(r);
}

/**
 * Bloco 2: cria um agente novo neste cliente, do padrão em branco, de um modelo da agência ou copiando outro agente.
 * Nasce em rascunho, sem versão publicada e sem número. Em modelo e cópia o texto é montado no banco.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const aberta = await abrirRotaDoCliente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpoLimitado(req, CriarAgenteSchema, LIMITE_DO_MODELO_BYTES);
  if (!corpo.ok) return corpo.resposta;
  const r = await criarAgente(aberta.clientes, { tenantId: aberta.tenantId, nome: corpo.corpo.nome, inicio: corpo.corpo.inicio });
  return r.ok ? json(r.dados, 201) : responderFalha(r);
}
