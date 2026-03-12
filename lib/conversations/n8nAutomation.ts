type NotifyConversationAutomationParams = {
  webhookUrl: string;
  secret: string | null;
  payload: Record<string, unknown>;
};

function buildHeaders(secret: string | null) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };

  if (secret) {
    headers['x-webhook-secret'] = secret;
    headers.authorization = `Bearer ${secret}`;
  }

  return headers;
}

export async function notifyConversationAutomation(params: NotifyConversationAutomationParams) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(params.webhookUrl, {
      method: 'POST',
      headers: buildHeaders(params.secret),
      body: JSON.stringify(params.payload),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Webhook automation respondeu HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
