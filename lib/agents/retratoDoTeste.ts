import 'server-only';

import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { RespostaDoRetrato, RetratoDoTeste } from './tiposDoEditor';

/** Quanto tempo depois do teste a explicação ainda pode ser pedida. */
export const VALIDADE_DO_RETRATO_MS = 15 * 60_000;
const ROTULO = 'central-agentes:retrato-do-teste:v1';

/**
 * Chave derivada (HKDF) do segredo do Supabase que o servidor já tem, com rótulo próprio: não cria variável de
 * ambiente nova (que seria escrita na configuração de produção) e não usa o segredo como chave direta. Trocar o
 * segredo só invalida os retratos ainda abertos, que duram 15 minutos.
 */
function chave(): Buffer | null {
  const segredo = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return segredo ? Buffer.from(hkdfSync('sha256', segredo, '', ROTULO, 32)) : null;
}

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** Mesma ordem de campos na assinatura e na conferência, venha o objeto de onde vier. */
function canonica(r: RespostaDoRetrato): string {
  return JSON.stringify({
    partes: [...r.partes],
    repasse: r.repasse ? { tipo: r.repasse.tipo, motivo: r.repasse.motivo } : null,
  });
}

type Vinculo = { tenantId: string; agentId: string; revisao: number };

function conteudo(
  v: Vinculo,
  prompt: string,
  provedor: string,
  modelo: string,
  expiraEm: number,
  resposta: RespostaDoRetrato,
): string {
  return JSON.stringify(['v1', v.tenantId, v.agentId, v.revisao, provedor, modelo, expiraEm, sha256(prompt), sha256(canonica(resposta))]);
}

export function assinarRetrato(
  v: Vinculo & { prompt: string; provedor: RetratoDoTeste['provedor']; modelo: string; resposta: RespostaDoRetrato },
  agora = Date.now(),
): RetratoDoTeste | null {
  const k = chave();
  if (!k) return null;
  const expiraEm = agora + VALIDADE_DO_RETRATO_MS;
  const assinatura = createHmac('sha256', k)
    .update(conteudo(v, v.prompt, v.provedor, v.modelo, expiraEm, v.resposta))
    .digest('hex');
  return { prompt: v.prompt, provedor: v.provedor, modelo: v.modelo, expiraEm, assinatura };
}

export function conferirRetrato(
  v: Vinculo & { retrato: RetratoDoTeste; resposta: RespostaDoRetrato },
  agora = Date.now(),
): 'ok' | 'invalido' | 'vencido' | 'sem_chave' {
  const k = chave();
  if (!k) return 'sem_chave';
  const esperada = createHmac('sha256', k)
    .update(conteudo(v, v.retrato.prompt, v.retrato.provedor, v.retrato.modelo, v.retrato.expiraEm, v.resposta))
    .digest();
  const recebida = /^[0-9a-f]{64}$/.test(v.retrato.assinatura) ? Buffer.from(v.retrato.assinatura, 'hex') : Buffer.alloc(0);
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return 'invalido';
  return v.retrato.expiraEm < agora ? 'vencido' : 'ok';
}
