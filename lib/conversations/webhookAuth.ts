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
 * Regra de segurança (fix do achado Critical 3): se a conexão TEM `webhookSecret`
 * configurado, é obrigatório enviar o secret válido — o fallback por `instanceName`
 * NÃO autoriza, porque o instanceName vem do próprio payload (não é segredo).
 * O fallback só vale para conexões legadas que ainda não têm secret configurado.
 */
export function evaluateWebhookAuth(input: WebhookAuthInput): WebhookAuthResult {
  const expectedSecret = input.expectedSecret.trim();
  const requestSecret = input.requestSecret.trim();
  const configuredInstanceName = input.configuredInstanceName.trim();
  const payloadInstanceName = input.payloadInstanceName.trim();

  const authorizedBySecret = Boolean(
    expectedSecret && requestSecret && timingSafeEqualString(requestSecret, expectedSecret)
  );

  // Fallback por instanceName SÓ para conexões legadas sem secret configurado.
  const authorizedByInstanceFallback = Boolean(
    !expectedSecret &&
      !requestSecret &&
      configuredInstanceName &&
      payloadInstanceName &&
      configuredInstanceName.toLowerCase() === payloadInstanceName.toLowerCase()
  );

  const authMode: WebhookAuthMode = authorizedBySecret
    ? 'secret'
    : authorizedByInstanceFallback
      ? 'instance_fallback'
      : 'no_secret_configured';

  // Com secret configurado, exigir secret válido. Sem secret (legado), aceitar.
  const authorized = expectedSecret ? authorizedBySecret : true;

  return { authorized, authMode };
}
