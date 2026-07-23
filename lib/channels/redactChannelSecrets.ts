const SENSITIVE_LABEL = /\b(?:api[-_ ]?key|webhook[-_ ]?secret)\b/gi;
const SENSITIVE_ASSIGNMENT =
  /(["']?)(?:api[-_ ]?key|webhook[-_ ]?secret)\1(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const SENSITIVE_PROPERTY = /^(?:api[-_ ]?key|webhook[-_ ]?secret)$/i;

function toMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string' && value) return value;
  if (
    value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof value.message === 'string' &&
    value.message
  ) {
    return value.message;
  }
  return fallback;
}

/**
 * Redige credenciais conhecidas antes de devolver mensagens de provedores externos.
 *
 * O uso de substituição literal evita interpretar caracteres da credencial como regex.
 */
export function redactChannelSecrets(
  value: unknown,
  secrets: readonly unknown[],
  fallback: string,
): string {
  const variants = new Set<string>();

  for (const candidate of secrets) {
    const secret = typeof candidate === 'string' ? candidate.trim() : '';
    if (!secret) continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
  }

  let safe = toMessage(value, fallback);
  for (const secret of [...variants].sort((left, right) => right.length - left.length)) {
    safe = safe.split(secret).join('[redigido]');
  }

  safe = safe.replace(
    SENSITIVE_ASSIGNMENT,
    (_assignment, quote: string, separator: string) =>
      `${quote}credencial${quote}${separator}[redigido]`,
  );

  return safe.replace(SENSITIVE_LABEL, 'credencial');
}

/**
 * Sanitiza payloads JSON de provedores antes de persistir ou serializar metadata.
 * Propriedades secretas são removidas; strings aninhadas passam pela mesma redação.
 */
export function redactChannelPayload(
  value: unknown,
  secrets: readonly unknown[],
): unknown {
  if (typeof value === 'string') {
    return redactChannelSecrets(value, secrets, value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactChannelPayload(item, secrets));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_PROPERTY.test(key))
      .map(([key, nested]) => [key, redactChannelPayload(nested, secrets)]),
  );
}
