export type EvolutionConnectionState = {
  raw: unknown;
  normalizedStatus: 'connected' | 'disconnected' | 'error';
  stateLabel: string;
};

export type EvolutionPairingCode = {
  raw: unknown;
  qrBase64: string | null;
  pairingCode: string | null;
  code: string | null;
  count: number | null;
};

export type EvolutionCreateInstanceResult = {
  raw: unknown;
  qrBase64: string | null;
  pairingCode: string | null;
  instanceName: string;
};

export type EvolutionSendMessageResult = {
  raw: unknown;
  providerMessageId: string | null;
  attemptLabel: string;
};

export type EvolutionWebhookSetResult = {
  raw: unknown;
};

export type EvolutionSendMode = 'auto' | 'number_text' | 'number_textMessage' | 'number_message' | 'number_body';

export class EvolutionDeliveryUnknownError extends Error {
  readonly deliveryUnknown = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EvolutionDeliveryUnknownError';
  }
}

class EvolutionHttpError extends Error {
  readonly deliveryUnknown: boolean;

  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'EvolutionHttpError';
    this.deliveryUnknown = status >= 500;
  }
}

export function isEvolutionDeliveryUnknown(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'deliveryUnknown' in error
    && (error as { deliveryUnknown?: unknown }).deliveryUnknown === true
  );
}

async function parseEvolutionResponse(response: Response) {
  const rawText = await response.text();
  let payload: unknown = rawText;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    const objectPayload = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : null;
    const nestedResponse = objectPayload?.response && typeof objectPayload.response === 'object'
      ? objectPayload.response as Record<string, unknown>
      : null;
    const providerMessage = [
      objectPayload?.message,
      typeof objectPayload?.error === 'string' ? objectPayload.error : null,
      nestedResponse?.message,
    ].find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    throw new EvolutionHttpError(
      typeof payload === 'string'
        ? payload || `Evolution respondeu HTTP ${response.status}`
        : providerMessage?.trim() || `Evolution respondeu HTTP ${response.status}`,
      response.status,
    );
  }

  return payload;
}

async function fetchEvolutionDelivery(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new EvolutionDeliveryUnknownError(
      error instanceof Error
        ? `resultado de entrega desconhecido: ${error.message}`
        : 'resultado de entrega desconhecido após o POST',
      { cause: error },
    );
  }
}

function readPayloadString(payload: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let current: unknown = payload;
    for (const segment of path) {
      if (!current || typeof current !== 'object') {
        current = null;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return null;
}

export async function createEvolutionInstance(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
}): Promise<EvolutionCreateInstanceResult> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/instance/create`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: params.apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      instanceName: params.instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      groupsIgnore: true,
      rejectCall: true,
      alwaysOnline: true,
    }),
  });
  const payload = await parseEvolutionResponse(response);

  return {
    raw: payload,
    qrBase64: readPayloadString(payload, [
      ['qrcode', 'base64'],
      ['qrcode', 'base64Image'],
      ['qrcode', 'qrCode'],
      ['base64'],
      ['qrBase64'],
    ]),
    pairingCode: readPayloadString(payload, [
      ['qrcode', 'pairingCode'],
      ['qrcode', 'code'],
      ['pairingCode'],
      ['code'],
    ]),
    instanceName: readPayloadString(payload, [
      ['instance', 'instanceName'],
      ['instance', 'instance_name'],
      ['instanceName'],
      ['instance_name'],
    ]) ?? params.instanceName,
  };
}

export async function logoutEvolutionInstance(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
}): Promise<unknown> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/instance/logout/${encodeURIComponent(params.instanceName)}`;

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      apikey: params.apiKey,
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  const payload = await parseEvolutionResponse(response);
  return payload;
}

function normalizeState(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export async function fetchEvolutionConnectionState(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
}): Promise<EvolutionConnectionState> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/instance/connectionState/${encodeURIComponent(params.instanceName)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      apikey: params.apiKey,
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  const payload = await parseEvolutionResponse(response);

  const candidate =
    (payload as any)?.instance?.state ??
    (payload as any)?.state ??
    (payload as any)?.status ??
    (payload as any)?.connectionState ??
    payload;

  const normalized = normalizeState(candidate);

  if (['open', 'connected', 'online'].includes(normalized)) {
    return {
      raw: payload,
      normalizedStatus: 'connected',
      stateLabel: String(candidate || 'connected'),
    };
  }

  if (['close', 'closed', 'disconnected', 'offline', 'connecting', 'qrcode', 'qr'].includes(normalized)) {
    return {
      raw: payload,
      normalizedStatus: 'disconnected',
      stateLabel: String(candidate || 'disconnected'),
    };
  }

  return {
    raw: payload,
    normalizedStatus: normalized ? 'error' : 'disconnected',
    stateLabel: String(candidate || 'unknown'),
  };
}

export async function fetchEvolutionPairingCode(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
  number?: string;
}): Promise<EvolutionPairingCode> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const url = new URL(`${baseUrl}/instance/connect/${encodeURIComponent(params.instanceName)}`);

  if (params.number) {
    url.searchParams.set('number', params.number);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: params.apiKey,
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  const payload = await parseEvolutionResponse(response);

  return {
    raw: payload,
    qrBase64: readPayloadString(payload, [
      ['qrcode', 'base64'],
      ['qrcode', 'base64Image'],
      ['qrcode', 'qrCode'],
      ['base64'],
      ['qrBase64'],
    ]),
    pairingCode: readPayloadString(payload, [
      ['qrcode', 'pairingCode'],
      ['pairingCode'],
    ]),
    code: readPayloadString(payload, [
      ['qrcode', 'code'],
      ['code'],
    ]),
    count: typeof (payload as any)?.count === 'number' ? (payload as any).count : null,
  };
}

export async function setEvolutionWebhook(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
  webhookUrl: string;
  enabled?: boolean;
  events?: string[];
}): Promise<EvolutionWebhookSetResult> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/webhook/set/${encodeURIComponent(params.instanceName)}`;
  const events = params.events?.length
    ? params.events
    : ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'];

  const body = {
    enabled: params.enabled ?? true,
    url: params.webhookUrl,
    events,
    webhookByEvents: false,
    webhookBase64: false,
    webhook_by_events: false,
    webhook_base64: false,
    webhook: {
      enabled: params.enabled ?? true,
      url: params.webhookUrl,
      byEvents: false,
      base64: false,
      events,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: params.apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const payload = await parseEvolutionResponse(response);
  return { raw: payload };
}

function getProviderMessageId(payload: unknown) {
  const candidate =
    (payload as any)?.key?.id ??
    (payload as any)?.message?.key?.id ??
    (payload as any)?.id ??
    (payload as any)?.data?.id ??
    (payload as any)?.messageId ??
    null;

  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

export async function sendEvolutionTextMessage(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
  phone: string;
  text: string;
  sendMode?: EvolutionSendMode;
}): Promise<EvolutionSendMessageResult> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const attempts: Array<{ mode: Exclude<EvolutionSendMode, 'auto'>; label: string; endpoint: string; body: Record<string, unknown> }> = [
    {
      mode: 'number_text',
      label: 'sendText:number+text',
      endpoint: `${baseUrl}/message/sendText/${encodeURIComponent(params.instanceName)}`,
      body: {
        number: params.phone,
        text: params.text,
      },
    },
    {
      mode: 'number_textMessage',
      label: 'sendText:number+textMessage',
      endpoint: `${baseUrl}/message/sendText/${encodeURIComponent(params.instanceName)}`,
      body: {
        number: params.phone,
        options: {
          delay: 0,
        },
        textMessage: {
          text: params.text,
        },
      },
    },
    {
      mode: 'number_message',
      label: 'sendText:number+message',
      endpoint: `${baseUrl}/message/sendText/${encodeURIComponent(params.instanceName)}`,
      body: {
        number: params.phone,
        message: params.text,
      },
    },
    {
      mode: 'number_body',
      label: 'sendText:number+body',
      endpoint: `${baseUrl}/message/sendText/${encodeURIComponent(params.instanceName)}`,
      body: {
        number: params.phone,
        body: params.text,
      },
    },
  ];
  const orderedAttempts =
    params.sendMode && params.sendMode !== 'auto'
      ? [
          ...attempts.filter(attempt => attempt.mode === params.sendMode),
          ...attempts.filter(attempt => attempt.mode !== params.sendMode),
        ]
      : attempts;

  let lastError: Error | null = null;

  for (const attempt of orderedAttempts) {
    try {
      const response = await fetchEvolutionDelivery(attempt.endpoint, {
        method: 'POST',
        headers: {
          apikey: params.apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify(attempt.body),
      });

      const payload = await parseEvolutionResponse(response);
      return {
        raw: payload,
        providerMessageId: getProviderMessageId(payload),
        attemptLabel: attempt.label,
      };
    } catch (error) {
      if (isEvolutionDeliveryUnknown(error)) throw error;
      lastError = error instanceof Error ? error : new Error('Evolution send failed.');
    }
  }

  throw lastError || new Error('Evolution send failed.');
}

export type EvolutionMediaType = 'image' | 'video' | 'document' | 'audio';

/**
 * Envia mídia (imagem/vídeo/documento) pelo endpoint `/message/sendMedia/{instance}`.
 *
 * ⚠️ SERVER-SIDE only: usa a `apiKey` (secret) no header — nunca chamar do browser.
 * Mesmo padrão do `sendEvolutionTextMessage` (apikey header, parseEvolutionResponse,
 * providerMessageId). `media` aceita URL pública/assinada OU base64.
 */
export async function sendEvolutionMediaMessage(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
  phone: string;
  mediatype: EvolutionMediaType;
  media: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
}): Promise<EvolutionSendMessageResult> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/message/sendMedia/${encodeURIComponent(params.instanceName)}`;

  const body: Record<string, unknown> = {
    number: params.phone,
    mediatype: params.mediatype,
    media: params.media,
  };
  if (params.caption) body.caption = params.caption;
  if (params.fileName) body.fileName = params.fileName;
  if (params.mimetype) body.mimetype = params.mimetype;

  const response = await fetchEvolutionDelivery(endpoint, {
    method: 'POST',
    headers: {
      apikey: params.apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(body),
  });

  const payload = await parseEvolutionResponse(response);
  return {
    raw: payload,
    providerMessageId: getProviderMessageId(payload),
    attemptLabel: `sendMedia:${params.mediatype}`,
  };
}

/**
 * Envia áudio (PTT) pelo endpoint `/message/sendWhatsAppAudio/{instance}`.
 *
 * ⚠️ SERVER-SIDE only. `audio` aceita URL pública/assinada OU base64. A Evolution
 * auto-converte para PTT (a "bolha de áudio" do WhatsApp).
 */
export async function sendEvolutionAudioMessage(params: {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
  phone: string;
  audio: string;
}): Promise<EvolutionSendMessageResult> {
  const baseUrl = params.apiUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(params.instanceName)}`;

  const response = await fetchEvolutionDelivery(endpoint, {
    method: 'POST',
    headers: {
      apikey: params.apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      number: params.phone,
      audio: params.audio,
    }),
  });

  const payload = await parseEvolutionResponse(response);
  return {
    raw: payload,
    providerMessageId: getProviderMessageId(payload),
    attemptLabel: 'sendWhatsAppAudio',
  };
}
