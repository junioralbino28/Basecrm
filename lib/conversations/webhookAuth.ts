import { timingSafeEqualString } from '@/lib/security/timingSafeEqual';

export type WebhookAuthMode = 'secret' | 'instance_fallback' | 'no_secret_configured';

export interface WebhookAuthInput {
  /** webhookSecret configurado na conexão (vazio = conexão legada sem secret). */
  expectedSecret: string;
  /** secret extraído da request (query/header/bearer). */
  requestSecret: string;
  /** instanceName configurado na conexão. */
  configuredInstanceName: string;
  /** instanceName vindo do payload do webhook (NÃO é secreto — atacante-controlável). */
  payloadInstanceName: string;
}

export interface WebhookAuthResult {
  authorized: boolean;
  authMode: WebhookAuthMode;
}

/**
 * Decide se um POST no webhook Evolution está autorizado.
 *
 * Regra (fix do achado Critical 3 + parecer do Codex B1/G3/G11, 15/09/2026): só entra com o
 * segredo da conexão. Conexão sem `webhookSecret` é RECUSADA (antes era aceita "por legado", e
 * o `instanceName` do payload nem era conferido; a migration `20260915000000` preencheu o segredo
 * em toda conexão que não tinha). O `instanceName` nunca autoriza: vem do próprio payload.
 */
export function evaluateWebhookAuth(input: WebhookAuthInput): WebhookAuthResult {
  const expectedSecret = input.expectedSecret.trim();
  const requestSecret = input.requestSecret.trim();
  const configuredInstanceName = input.configuredInstanceName.trim();
  const payloadInstanceName = input.payloadInstanceName.trim();

  const authorizedBySecret = Boolean(
    expectedSecret && requestSecret && timingSafeEqualString(requestSecret, expectedSecret)
  );

  // `instance_fallback` fica no tipo só por compatibilidade com metadata antiga; nunca autoriza.
  void configuredInstanceName;
  void payloadInstanceName;

  const authMode: WebhookAuthMode = !expectedSecret ? 'no_secret_configured' : 'secret';

  return { authorized: authorizedBySecret, authMode };
}

/** Nome do cabeçalho em que a Evolution manda o segredo do webhook (registrado pelo CRM). */
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

/**
 * Lê o segredo enviado na request do webhook / ai-reply.
 * Ordem: cabeçalho `x-webhook-secret` → `Authorization: Bearer` → query `?secret=` (só para
 * registros antigos; a URL vaza em log/proxy/configuração, parecer do Codex I7).
 */
export function readWebhookSecretFromRequest(req: Request): string {
  const headerSecret = req.headers.get(WEBHOOK_SECRET_HEADER)?.trim();
  if (headerSecret) return headerSecret;

  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();

  const querySecret = new URL(req.url).searchParams.get('secret')?.trim();
  if (querySecret) return querySecret;

  return '';
}
