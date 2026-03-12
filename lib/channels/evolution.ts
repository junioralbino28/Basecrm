export type EvolutionConnectionState = {
  raw: unknown;
  normalizedStatus: 'connected' | 'disconnected' | 'error';
  stateLabel: string;
};

export type EvolutionPairingCode = {
  raw: unknown;
  pairingCode: string | null;
  code: string | null;
  count: number | null;
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

async function parseEvolutionResponse(response: Response) {
  const rawText = await response.text();
  let payload: unknown = rawText;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    throw new Error(
      typeof payload === 'string'
        ? payload || `Evolution respondeu HTTP ${response.status}`
        : `Evolution respondeu HTTP ${response.status}`
    );
  }

  return payload;
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
    pairingCode: typeof (payload as any)?.pairingCode === 'string' ? (payload as any).pairingCode : null,
    code: typeof (payload as any)?.code === 'string' ? (payload as any).code : null,
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
    webhookByEvents: true,
    webhookBase64: false,
    webhook_by_events: true,
    webhook_base64: false,
    webhook: {
      enabled: params.enabled ?? true,
      url: params.webhookUrl,
      byEvents: true,
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
      const response = await fetch(attempt.endpoint, {
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
      lastError = error instanceof Error ? error : new Error('Evolution send failed.');
    }
  }

  throw lastError || new Error('Evolution send failed.');
}
