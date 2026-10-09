import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { consumeConversationRateLimit } from '@/lib/conversations/conversationRateLimit';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import type { Clientes, Falha, Resultado } from './editorAgentes';
import { ocorrenciasDeLacunas } from './verificarPrompt';

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Uuid = z.string().uuid();
export const NumeroDaVersao = z.coerce.number().int().min(1).max(1_000_000);

/** Consulta do histórico (G5/G19): só `antesDe`, para pedir a página seguinte; outro parâmetro é 400. */
export const ConsultaDoHistorico = z.object({ antesDe: NumeroDaVersao.optional() }).strict();

/** Corpos aceitos (G5/G19): campo fora da lista é 400, nunca ignorado. O autor nunca vem do corpo. */
export const RascunhoSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  revisao: z.number().int().min(0),
}).strict();

export const PublicarSchema = z.object({
  versaoEsperada: z.number().int().min(0),
  revisao: z.number().int().min(0),
  nota: z.string().max(200).optional(),
  confirmarAvisos: z.array(z.string().min(1).max(120)).max(50).optional(),
}).strict();

export const RestaurarSchema = z.object({
  versao: z.number().int().min(1),
  versaoEsperada: z.number().int().min(0),
  revisao: z.number().int().min(0),
  nota: z.string().max(200).optional(),
}).strict();

/** Renomear e excluir agente (SPEC-renomear-excluir.md). O banco confere o nome de 1 a 80 depois do btrim. */
/** Teto dos dois corpos, lido em fluxo antes do JSON.parse (revisão do Codex no código, rodada 1, achado 2). */
export const LIMITE_DE_RENOMEAR_EXCLUIR_BYTES = 4 * 1024;
export const RenomearSchema = z.object({ nome: z.string().max(200) }).strict();

/** O estado que a tela mostrou na confirmação; diferente do atual, o banco recusa com 409 e nada é apagado. */
export const ExcluirSchema = z.object({
  nomeEsperado: z.string().max(200),
  revisaoEsperada: z.number().int().min(0),
  versaoPublicadaEsperada: Uuid.nullable(),
}).strict();

/** Bloco 2: corpo das rotas de criar agente e dos modelos (G5/G19: estrito; origem e autor nunca vêm daqui). */
export const LIMITE_DO_MODELO_BYTES = 256 * 1024;
const NomeCurto = z.string().trim().min(1).max(80);
const Descricao = z.string().trim().max(280).optional();
/** Uma lacuna é um texto que o detector da verificação reconhece INTEIRO como uma ocorrência só. */
const Lacuna = z.string().refine((k) => {
  const ocorrencias = ocorrenciasDeLacunas(k);
  return ocorrencias.length === 1 && ocorrencias[0] === k;
}, 'Lacuna inválida.');
const PROIBIDOS_NA_RESPOSTA = ['{', '}', '[', ']'];
const Resposta = z.string().max(500).refine((v) => !PROIBIDOS_NA_RESPOSTA.some((c) => v.includes(c)), 'Sem chaves nem colchetes.');

export const CriarAgenteSchema = z.object({
  nome: NomeCurto,
  inicio: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('branco') }).strict(),
    z.object({
      tipo: z.literal('modelo'),
      modeloId: Uuid,
      revisaoDoModelo: z.number().int().min(1),
      respostas: z.record(Lacuna, Resposta).refine((r) => Object.keys(r).length <= 50, 'No máximo 50 respostas.'),
    }).strict(),
    z.object({
      tipo: z.literal('copia'),
      clienteDeOrigemId: Uuid,
      agenteId: Uuid,
      versaoEsperada: z.number().int().min(1),
    }).strict(),
  ]),
}).strict();

export const SalvarModeloSchema = z.object({
  nome: NomeCurto,
  descricao: Descricao,
  prompt: z.string().min(1).max(50_000),
  revisaoEsperada: z.number().int().min(1),
}).strict();

export const CriarModeloSchema = z.union([
  z.object({ nome: NomeCurto, descricao: Descricao, prompt: z.string().min(1).max(50_000) }).strict(),
  z.object({
    nome: NomeCurto,
    descricao: Descricao,
    deAgente: z.object({ tenantId: Uuid, agenteId: Uuid, versaoEsperada: z.number().int().min(1) }).strict(),
  }).strict(),
]);

export const ArquivarModeloSchema = z.object({ arquivar: z.boolean(), revisaoEsperada: z.number().int().min(1) }).strict();

/** Consulta da lista de modelos: só `arquivados=1`; outro parâmetro é 400. */
export const ConsultaDosModelos = z.object({ arquivados: z.enum(['0', '1']).optional() }).strict();

type Recusa = { ok: false; resposta: Response };
const recusa = (body: unknown, status: number): Recusa => ({ ok: false, resposta: json(body, status) });

/**
 * Porta das rotas da Central de Agentes (G3). Na ordem: origem (só nas que escrevem), id do cliente válido,
 * requireTenantAccess com adminOnly (agency_admin e o legado admin; agency_staff e o cliente recebem 403) e os dois
 * clientes do Supabase: o do usuário (JWT) para ler pela RLS e escrever pelas funções, e o de serviço só para leitura.
 */
export async function abrirRotaDoCliente(
  req: Request,
  params: { tenantId: string },
  opcoes: { escreve: boolean },
): Promise<{ ok: true; tenantId: string; usuarioId: string | null; clientes: Clientes } | Recusa> {
  if (opcoes.escreve && !isAllowedOrigin(req)) return recusa({ error: 'Forbidden' }, 403);
  if (!Uuid.safeParse(params.tenantId).success) return recusa({ error: 'Endereço inválido.' }, 400);
  const auth = await requireTenantAccess(params.tenantId, { adminOnly: true });
  // `'error' in auth` não estreita aqui: o TypeScript normaliza a união do retorno (error?: undefined no sucesso).
  if (auth.error) return { ok: false, resposta: auth.error };
  return {
    ok: true,
    tenantId: params.tenantId,
    usuarioId: auth.profile?.id ?? null,
    clientes: { usuario: await createClient(), admin: createStaticAdminClient() },
  };
}

export async function abrirRotaDoAgente(
  req: Request,
  params: { tenantId: string; agentId: string },
  opcoes: { escreve: boolean },
): Promise<{ ok: true; tenantId: string; agentId: string; usuarioId: string | null; clientes: Clientes } | Recusa> {
  if (!Uuid.safeParse(params.agentId).success) return recusa({ error: 'Endereço inválido.' }, 400);
  const aberta = await abrirRotaDoCliente(req, params, opcoes);
  if (!aberta.ok) return aberta;
  return { ...aberta, agentId: params.agentId };
}

export async function lerCorpo<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; corpo: T } | Recusa> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recusa({ error: 'Pedido inválido.', details: parsed.error.flatten() }, 400);
  return { ok: true, corpo: parsed.data };
}

export const LIMITE_DO_TESTE_BYTES = 512 * 1024;
export const LIMITE_DA_EXPLICACAO_BYTES = 1024 * 1024;

/**
 * Corpo lido em fluxo com teto em bytes ANTES do JSON.parse (D14, G7/G18): `content-length` acima do teto já é 413,
 * e um corpo sem `content-length` é cortado ao passar do teto. Depois, o zod estrito de sempre.
 */
export async function lerCorpoLimitado<T>(
  req: Request,
  schema: z.ZodType<T>,
  maxBytes: number,
): Promise<{ ok: true; corpo: T } | Recusa> {
  const grande = () => recusa({ error: 'Pedido grande demais.', code: 'CORPO_GRANDE' }, 413);
  const declarado = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declarado) && declarado > maxBytes) return grande();
  if (!req.body) return recusa({ error: 'Pedido inválido.' }, 400);
  const leitor = req.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel().catch(() => undefined);
      return grande();
    }
    pedacos.push(value);
  }
  let bruto: unknown = null;
  try {
    bruto = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
  } catch {
    bruto = null;
  }
  const parsed = schema.safeParse(bruto);
  if (!parsed.success) return recusa({ error: 'Pedido inválido.', details: parsed.error.flatten() }, 400);
  return { ok: true, corpo: parsed.data };
}

const MensagemSimuladaSchema = z.discriminatedUnion('autor', [
  z.object({ autor: z.literal('lead'), texto: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ autor: z.literal('agente'), texto: z.string().trim().min(1).max(4_000) }).strict(),
]);

/** Corpo do teste (G5/G19 e D1-D4): até 30 mensagens, a última do lead; campo fora da lista é 400. */
export const TesteSchema = z.object({
  revisao: z.number().int().min(0),
  mensagens: z.array(MensagemSimuladaSchema).min(1).max(30)
    .refine((m) => m[m.length - 1]?.autor === 'lead', { message: 'A última mensagem precisa ser do lead.' }),
  numeroId: z.string().uuid().nullable().optional(),
  nomeDoLead: z.string().trim().min(1).max(80).optional(),
}).strict();

/** Corpo da explicação (D7): o retrato assinado do teste e a resposta mostrada. */
export const ExplicarSchema = z.object({
  revisao: z.number().int().min(0),
  retrato: z.object({
    prompt: z.string().min(1).max(200_000),
    provedor: z.enum(['google', 'openai', 'anthropic']),
    // Igual a LIMITE_DO_ID_DO_MODELO do motor e ao aiModel da configuração de IA (rodada 4 do Codex, achado 4).
    modelo: z.string().min(1).max(200),
    expiraEm: z.number().int().positive(),
    assinatura: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
  resposta: z.object({
    partes: z.array(z.string().min(1).max(4_000)).min(1).max(3),
    repasse: z.object({ tipo: z.string().min(1).max(40), motivo: z.string().max(240).nullable() }).strict().nullable(),
  }).strict(),
}).strict();

/**
 * Os baldes do teste e da explicação (D6), na ordem em que são consumidos. O último é o teto de custo do cliente (G18,
 * rodada 3 do Codex): com o prompt limitado (LIMITE_DO_PROMPT_DO_TESTE) e a saída limitada (maxOutputTokens), 200
 * chamadas por dia limitam o consumo diário em tokens na chave do cliente. O valor em reais depende do modelo
 * configurado e não é calculado aqui (fatia 5).
 */
export const BALDES_DO_TESTE = [
  { nome: 'pessoa', por: 'pessoa', limite: 20, janelaSegundos: 600, mensagem: 'Limite de 20 testes a cada 10 minutos por pessoa.' },
  { nome: 'rajada', por: 'pessoa', limite: 3, janelaSegundos: 30, mensagem: 'Muitos testes ao mesmo tempo. Espere a resposta anterior.' },
  { nome: 'cliente', por: 'cliente', limite: 60, janelaSegundos: 600, mensagem: 'Limite de 60 testes a cada 10 minutos neste cliente.' },
  { nome: 'cliente-dia', por: 'cliente', limite: 200, janelaSegundos: 86_400, mensagem: 'Limite de 200 testes por dia neste cliente.' },
] as const;

/**
 * Disjuntor do provedor (G18): falhas do modelo no cliente (erro, prazo estourado ou resposta vazia) são contadas num
 * balde próprio; com 5 na janela de 5 minutos, o teste e a explicação param até a janela vencer, sem chamar o modelo.
 */
export const DISJUNTOR_DO_TESTE = { falhas: 5, janelaSegundos: 300 } as const;
export const CODIGOS_DE_FALHA_DO_PROVEDOR: ReadonlySet<string> = new Set(['FALHA_DO_MODELO', 'MODELO_DEMOROU', 'RESPOSTA_VAZIA']);
const chaveDoDisjuntor = (tenantId: string) => `central-agentes:teste:falhas:${tenantId}`;

const recusaDoDisjuntor = (mensagem: string, retryAfter: number) =>
  new Response(JSON.stringify({ error: mensagem, code: 'IA_INSTAVEL' }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(retryAfter) },
  });

/** Só lê o balde das falhas, sem consumir. Leitura com erro fecha (503), como os limites. */
async function conferirDisjuntor(admin: SupabaseClient, tenantId: string): Promise<Response | null> {
  const lido = await Promise.resolve(
    admin
      .from('conversation_ai_rate_limits')
      .select('window_started_at, request_count')
      .eq('scope_key', chaveDoDisjuntor(tenantId))
      .maybeSingle(),
  ).catch(() => null);
  if (!lido || lido.error) {
    return recusaDoDisjuntor('Não foi possível conferir a saúde da IA agora. Tente de novo em instantes.', 30);
  }
  const linha = lido.data as { window_started_at?: string; request_count?: number } | null;
  if (!linha) return null;
  const inicio = Date.parse(String(linha.window_started_at));
  const resta = Math.ceil((inicio + DISJUNTOR_DO_TESTE.janelaSegundos * 1000 - Date.now()) / 1000);
  if (Number(linha.request_count) >= DISJUNTOR_DO_TESTE.falhas && resta > 0) {
    return recusaDoDisjuntor(
      `O provedor de IA falhou ${DISJUNTOR_DO_TESTE.falhas} vezes nos últimos minutos neste cliente. Os testes voltam em ${resta} s.`,
      resta,
    );
  }
  return null;
}

/** Conta a falha do provedor no disjuntor. Não registrar não muda a resposta já decidida. */
export async function contarFalhaDoProvedor(admin: SupabaseClient, tenantId: string, r: Resultado<unknown>): Promise<void> {
  if (r.ok || !CODIGOS_DE_FALHA_DO_PROVEDOR.has(r.codigo)) return;
  await consumeConversationRateLimit({
    admin: admin as never,
    scopeKey: chaveDoDisjuntor(tenantId),
    limit: DISJUNTOR_DO_TESTE.falhas,
    windowSeconds: DISJUNTOR_DO_TESTE.janelaSegundos,
  }).catch(() => undefined);
}

/**
 * Antes do modelo: o disjuntor (só leitura; aberto, nada é consumido) e depois os baldes. Falha fechada: recusa, erro
 * devolvido ou chamada rejeitada em qualquer balde vira 429 com `retry-after`. Um balde que já consumiu não devolve a
 * vaga quando o seguinte recusa: a contagem erra para mais, nunca para menos.
 */
export async function consumirLimitesDeTeste(
  admin: SupabaseClient,
  usuarioId: string | null,
  tenantId: string,
): Promise<Response | null> {
  if (!usuarioId) return json({ error: 'Forbidden' }, 403);
  const disjuntor = await conferirDisjuntor(admin, tenantId);
  if (disjuntor) return disjuntor;
  for (const balde of BALDES_DO_TESTE) {
    const dono = balde.por === 'cliente' ? tenantId : usuarioId;
    // O adaptador trata `{ error }`; uma rejeição da chamada (rede) também fecha, com 429 e não 500 (rodada 2, ponto 3).
    const r = await consumeConversationRateLimit({
      admin: admin as never,
      scopeKey: `central-agentes:teste:${balde.nome}:${dono}`,
      limit: balde.limite,
      windowSeconds: balde.janelaSegundos,
    }).catch(() => ({ allowed: false, retryAfterSeconds: balde.janelaSegundos }));
    if (!r.allowed) {
      return new Response(
        JSON.stringify({ error: `${balde.mensagem} Tente de novo em ${r.retryAfterSeconds} s.`, code: 'LIMITE_DE_TESTES' }),
        { status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(r.retryAfterSeconds) } },
      );
    }
  }
  return null;
}

export function responderFalha(f: Falha) {
  return json({ error: f.erro, code: f.codigo, ...(f.verificacao ? { verificacao: f.verificacao } : {}) }, f.status);
}
