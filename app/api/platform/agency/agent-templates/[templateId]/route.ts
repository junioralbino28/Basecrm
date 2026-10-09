import { z } from 'zod';
import { lerModelo, salvarModelo } from '@/lib/agents/modelosAgentes';
import { abrirRotaDaAgencia } from '@/lib/agents/rotaDaAgencia';
import { LIMITE_DO_MODELO_BYTES, SalvarModeloSchema, json, lerCorpoLimitado, responderFalha } from '@/lib/agents/rotaDoEditor';

const IdDoModelo = z.string().uuid();

/** Bloco 2: um modelo da agência, com o texto. */
export async function GET(req: Request, ctx: { params: Promise<{ templateId: string }> }) {
  const aberta = await abrirRotaDaAgencia(req, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const { templateId } = await ctx.params;
  if (!IdDoModelo.safeParse(templateId).success) return json({ error: 'Endereço inválido.' }, 400);
  const r = await lerModelo(aberta.clientes, templateId);
  return r.ok ? json(r.dados) : responderFalha(r);
}

/** Salva o modelo com a revisão que a tela leu; se outra pessoa salvou antes, 409 em vez de sobrescrever. */
export async function PUT(req: Request, ctx: { params: Promise<{ templateId: string }> }) {
  const aberta = await abrirRotaDaAgencia(req, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const { templateId } = await ctx.params;
  if (!IdDoModelo.safeParse(templateId).success) return json({ error: 'Endereço inválido.' }, 400);
  const corpo = await lerCorpoLimitado(req, SalvarModeloSchema, LIMITE_DO_MODELO_BYTES);
  if (!corpo.ok) return corpo.resposta;
  const r = await salvarModelo(aberta.clientes, {
    id: templateId,
    revisaoEsperada: corpo.corpo.revisaoEsperada,
    nome: corpo.corpo.nome,
    descricao: corpo.corpo.descricao ?? null,
    prompt: corpo.corpo.prompt,
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
