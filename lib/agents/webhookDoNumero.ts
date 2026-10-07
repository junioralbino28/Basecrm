import type { SupabaseClient } from '@supabase/supabase-js';
import { findEvolutionWebhook } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';

export type MotivoDoWebhook =
  | 'conexao_inexistente'
  | 'conexao_nao_evolution'
  | 'sem_instancia'
  | 'sem_credenciais'
  | 'webhook_ilegivel'
  | 'webhook_desligado'
  | 'webhook_fora_da_lista';

export type WebhookDoNumero = { ok: true; host: string } | { ok: false; motivo: MotivoDoWebhook; detalhe: string };

/**
 * Lê na Evolution (GET /webhook/find/{instância}) onde o webhook do número está registrado e exige um domínio da lista
 * fechada do ambiente (SPEC, fatia 2). O CRM grava esse endereço com a origem de quem clicou em conectar ou no
 * healthcheck (lib/channels/evolutionWebhookRegistration.ts): pode ser uma prévia, servida por outro código.
 * Nunca devolve a query, os cabeçalhos nem o corpo da Evolution: o segredo do webhook mora ali.
 */
export async function conferirWebhookDoNumero(params: {
  admin: SupabaseClient;
  connectionId: string;
  dominios: readonly string[];
  buscarWebhook?: typeof findEvolutionWebhook;
}): Promise<WebhookDoNumero> {
  const { admin, connectionId, dominios, buscarWebhook = findEvolutionWebhook } = params;
  const lida = await admin
    .from('channel_connections')
    .select('id, organization_id, provider, config')
    .eq('id', connectionId)
    .maybeSingle();
  if (lida.error) return { ok: false, motivo: 'webhook_ilegivel', detalhe: `leitura do numero falhou (${lida.error.message})` };
  if (!lida.data) return { ok: false, motivo: 'conexao_inexistente', detalhe: 'o numero nao existe neste banco' };
  if (lida.data.provider !== 'evolution') return { ok: false, motivo: 'conexao_nao_evolution', detalhe: `provider ${String(lida.data.provider)}` };
  const config = (lida.data.config ?? {}) as Record<string, unknown>;
  const instancia = typeof config.instanceName === 'string' ? config.instanceName.trim() : '';
  if (!instancia) return { ok: false, motivo: 'sem_instancia', detalhe: 'config.instanceName vazio' };
  const credenciais = await resolveEvolutionCredentials({
    admin,
    tenantId: lida.data.organization_id as string,
    connectionConfig: config,
  });
  if (!credenciais) return { ok: false, motivo: 'sem_credenciais', detalhe: 'sem o par completo de URL e chave da Evolution (no numero ou na agencia)' };

  let url: string | null;
  let ligado: boolean | null;
  try {
    const achado = await buscarWebhook({ apiUrl: credenciais.apiUrl, instanceName: instancia, apiKey: credenciais.apiKey });
    url = achado.url;
    ligado = achado.enabled;
  } catch (erro) {
    // Só o tipo do erro: a mensagem pode trazer o que a Evolution respondeu.
    return { ok: false, motivo: 'webhook_ilegivel', detalhe: `GET /webhook/find falhou (${erro instanceof Error ? erro.name : 'erro'})` };
  }
  if (ligado !== true) return { ok: false, motivo: 'webhook_desligado', detalhe: `enabled=${String(ligado)}` };

  let endereco: URL;
  try {
    endereco = new URL(url ?? '');
  } catch {
    return { ok: false, motivo: 'webhook_ilegivel', detalhe: 'endereco do webhook ausente ou invalido' };
  }
  const caminho = `/api/public/channels/evolution/${connectionId}/webhook`;
  const confere = endereco.protocol === 'https:'
    && endereco.port === ''
    && endereco.username === ''
    && endereco.password === ''
    && dominios.includes(endereco.hostname)
    && endereco.pathname === caminho;
  if (!confere) {
    return {
      ok: false,
      motivo: 'webhook_fora_da_lista',
      detalhe: `host=${endereco.hostname} protocolo=${endereco.protocol} porta=${endereco.port || 'padrao'} caminho_confere=${endereco.pathname === caminho}`,
    };
  }
  return { ok: true, host: endereco.hostname };
}
