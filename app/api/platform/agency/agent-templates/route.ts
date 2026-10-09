import { criarModeloDeAgente, listarModelos, salvarModelo } from '@/lib/agents/modelosAgentes';
import { abrirRotaDaAgencia } from '@/lib/agents/rotaDaAgencia';
import {
  ConsultaDosModelos,
  CriarModeloSchema,
  LIMITE_DO_MODELO_BYTES,
  json,
  lerCorpoLimitado,
  responderFalha,
} from '@/lib/agents/rotaDoEditor';

/** Central de Agentes, bloco 2: a biblioteca de modelos da agência. Só agency_admin (e o legado admin). */
export async function GET(req: Request) {
  const aberta = await abrirRotaDaAgencia(req, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const consulta = ConsultaDosModelos.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!consulta.success) return json({ error: 'Pedido inválido.' }, 400);
  const r = await listarModelos(aberta.clientes, { arquivados: consulta.data.arquivados === '1' });
  return r.ok ? json(r.dados) : responderFalha(r);
}

/** Cria um modelo: com texto, ou a partir da versão publicada de um agente (o texto vai igual, montado no banco). */
export async function POST(req: Request) {
  const aberta = await abrirRotaDaAgencia(req, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpoLimitado(req, CriarModeloSchema, LIMITE_DO_MODELO_BYTES);
  if (!corpo.ok) return corpo.resposta;
  const pedido = corpo.corpo;
  if ('deAgente' in pedido) {
    const r = await criarModeloDeAgente(aberta.clientes, {
      tenantId: pedido.deAgente.tenantId,
      agenteId: pedido.deAgente.agenteId,
      versaoEsperada: pedido.deAgente.versaoEsperada,
      nome: pedido.nome,
      descricao: pedido.descricao ?? null,
    });
    return r.ok ? json(r.dados, 201) : responderFalha(r);
  }
  const r = await salvarModelo(aberta.clientes, {
    id: null,
    revisaoEsperada: null,
    nome: pedido.nome,
    descricao: pedido.descricao ?? null,
    prompt: pedido.prompt,
  });
  return r.ok ? json(r.dados, 201) : responderFalha(r);
}
