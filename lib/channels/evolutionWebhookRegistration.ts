import { findEvolutionWebhook, setEvolutionWebhook } from '@/lib/channels/evolution';

export const CRM_WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

export type CrmWebhookTransport = 'header' | 'query';

export type CrmWebhookRegistration = {
  /** Onde o segredo ficou: no cabeçalho (padrão) ou na URL (só quando a Evolution não guarda cabeçalhos). */
  transport: CrmWebhookTransport;
  /** Aviso em linguagem leiga quando caiu para a URL (legado). */
  warning: string | null;
};

/**
 * Registra na Evolution o webhook do CRM para uma conexão (parecer do Codex, I7 — G10/G11/G22).
 *
 * O segredo vai no cabeçalho `x-webhook-secret`, não na query string: URL aparece em log, tracing,
 * proxy e na configuração do provedor; cabeçalho não. Depois de registrar, confere com
 * `GET /webhook/find` que a Evolution guardou o cabeçalho; se não guardou (versão antiga), registra
 * de novo com o segredo na URL e devolve um aviso, para o inbound não parar em silêncio.
 * Erros de rede/HTTP sobem para o chamador, que já redige e transforma em aviso.
 */
export async function registerCrmWebhook(params: {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  requestOrigin: string;
  connectionId: string;
  webhookSecret: string;
}): Promise<CrmWebhookRegistration> {
  const baseUrl = `${params.requestOrigin}/api/public/channels/evolution/${params.connectionId}/webhook`;
  const credentials = { apiUrl: params.apiUrl, apiKey: params.apiKey, instanceName: params.instanceName };

  await setEvolutionWebhook({
    ...credentials,
    webhookUrl: baseUrl,
    headers: { [CRM_WEBHOOK_SECRET_HEADER]: params.webhookSecret },
  });

  const stored = await findEvolutionWebhook(credentials);
  const storedHeader = stored.headers?.[CRM_WEBHOOK_SECRET_HEADER];
  if (typeof storedHeader === 'string' && storedHeader === params.webhookSecret) {
    return { transport: 'header', warning: null };
  }

  await setEvolutionWebhook({
    ...credentials,
    webhookUrl: `${baseUrl}?secret=${encodeURIComponent(params.webhookSecret)}`,
  });
  return {
    transport: 'query',
    warning:
      'Esta Evolution não guarda cabeçalhos no webhook; o segredo ficou na URL (modo antigo). '
      + 'Atualize a Evolution para o segredo sair da URL.',
  };
}
