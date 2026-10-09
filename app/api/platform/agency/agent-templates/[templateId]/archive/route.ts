import { z } from 'zod';
import { arquivarModelo } from '@/lib/agents/modelosAgentes';
import { abrirRotaDaAgencia } from '@/lib/agents/rotaDaAgencia';
import { ArquivarModeloSchema, LIMITE_DO_MODELO_BYTES, json, lerCorpoLimitado, responderFalha } from '@/lib/agents/rotaDoEditor';

const IdDoModelo = z.string().uuid();

/** Bloco 2: arquiva ou restaura um modelo (nunca apaga: os agentes guardam a origem). */
export async function POST(req: Request, ctx: { params: Promise<{ templateId: string }> }) {
  const aberta = await abrirRotaDaAgencia(req, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const { templateId } = await ctx.params;
  if (!IdDoModelo.safeParse(templateId).success) return json({ error: 'Endereço inválido.' }, 400);
  const corpo = await lerCorpoLimitado(req, ArquivarModeloSchema, LIMITE_DO_MODELO_BYTES);
  if (!corpo.ok) return corpo.resposta;
  const r = await arquivarModelo(aberta.clientes, {
    id: templateId,
    arquivar: corpo.corpo.arquivar,
    revisaoEsperada: corpo.corpo.revisaoEsperada,
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
