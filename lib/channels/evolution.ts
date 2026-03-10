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

  return {
    raw: payload,
    pairingCode: typeof (payload as any)?.pairingCode === 'string' ? (payload as any).pairingCode : null,
    code: typeof (payload as any)?.code === 'string' ? (payload as any).code : null,
    count: typeof (payload as any)?.count === 'number' ? (payload as any).count : null,
  };
}
