/**
 * Clique de anúncio (Click-to-WhatsApp) que veio junto com a mensagem. A Evolution
 * entrega em `contextInfo.externalAdReply` (conferido em 384 mensagens reais).
 * Nada aqui é dado clínico: é a etiqueta do clique e a identidade do anúncio.
 */
export type EvolutionAdClick = {
  /** Etiqueta do clique. É a única chave que liga a pessoa ao anúncio na Meta. */
  ctwaClid: string | null;
  /** Título do anúncio, como a Meta entrega. */
  title: string | null;
  /** ID do anúncio na Meta (`externalAdReply.sourceId`). */
  sourceId: string | null;
  sourceUrl: string | null;
  /** 'instagram' | 'facebook' | outro, como veio. */
  sourceApp: string | null;
  /** 'ad' na prática; guardado como veio. */
  sourceType: string | null;
  mediaUrl: string | null;
};

type ParsedEvolutionMessage = {
  event: string | null;
  providerMessageId: string | null;
  quotedProviderMessageId: string | null;
  direction: 'inbound' | 'outbound';
  messageType: string;
  content: string | null;
  contactName: string | null;
  contactPhone: string | null;
  sentAt: string;
  adClick: EvolutionAdClick | null;
  raw: Record<string, unknown>;
};

function getObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNested(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    const next = getObject(current);
    if (!next) return null;
    current = next[key];
  }
  return current;
}

function getFirstString(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function normalizePhone(value: string | null) {
  if (!value) return null;
  if (value.includes('@g.us')) return null;
  return value.replace(/@s\.whatsapp\.net$/i, '').replace(/\D+/g, '') || null;
}

function toIsoDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epochMs = value > 10_000_000_000 ? value : value * 1000;
    return new Date(epochMs).toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return new Date().toISOString();

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      const epochMs = asNumber > 10_000_000_000 ? asNumber : asNumber * 1000;
      return new Date(epochMs).toISOString();
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

function inferMessageType(message: Record<string, unknown> | null, fallback: unknown) {
  if (message) {
    const keys = Object.keys(message);
    if (keys.length > 0) return keys[0];
  }

  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return 'text';
}

function extractContent(root: Record<string, unknown>, message: Record<string, unknown> | null) {
  return getFirstString([
    getNested(message, ['conversation']),
    getNested(message, ['extendedTextMessage', 'text']),
    getNested(message, ['imageMessage', 'caption']),
    getNested(message, ['videoMessage', 'caption']),
    getNested(message, ['documentMessage', 'caption']),
    getNested(message, ['documentMessage', 'fileName']),
    getNested(message, ['buttonsResponseMessage', 'selectedDisplayText']),
    getNested(message, ['listResponseMessage', 'title']),
    getNested(message, ['listResponseMessage', 'singleSelectReply', 'selectedRowId']),
    getNested(message, ['templateButtonReplyMessage', 'selectedDisplayText']),
    getNested(message, ['interactiveResponseMessage', 'body', 'text']),
    // Primeira mensagem de quem clica em anúncio pode chegar como interactiveMessage
    // (57 casos reais); sem isto o lead era descartado antes de virar contato.
    getNested(message, ['interactiveMessage', 'body', 'text']),
    root.body,
    root.text,
    getNested(root, ['data', 'body']),
    getNested(root, ['data', 'text']),
  ]);
}

const AD_FIELD_MAX_LENGTH = 512;

function clip(value: string | null) {
  return value && value.length > AD_FIELD_MAX_LENGTH ? value.slice(0, AD_FIELD_MAX_LENGTH) : value;
}

/**
 * Procura o bloco do anúncio no nível do evento (onde a Evolution o sobe, inclusive
 * para `conversation`, que não tem contextInfo próprio) e dentro de cada tipo de
 * mensagem (`interactiveMessage`, `audioMessage`, ...). Nunca dentro de
 * `quotedMessage`: ali o anúncio pertence à mensagem citada, não a esta.
 */
function extractAdClick(
  envelope: Record<string, unknown>,
  message: Record<string, unknown> | null
): EvolutionAdClick | null {
  const candidates: unknown[] = [getNested(envelope, ['contextInfo', 'externalAdReply'])];
  if (message) {
    for (const key of Object.keys(message)) {
      candidates.push(getNested(message, [key, 'contextInfo', 'externalAdReply']));
    }
  }

  const adReply = candidates
    .map(getObject)
    .find((candidate): candidate is Record<string, unknown> => candidate !== null);
  if (!adReply) return null;

  const ctwaClid = clip(getFirstString([adReply.ctwaClid, adReply.ctwa_clid]));
  const sourceId = clip(getFirstString([adReply.sourceId, adReply.source_id]));
  if (!ctwaClid && !sourceId) return null;

  return {
    ctwaClid,
    title: clip(getFirstString([adReply.title])),
    sourceId,
    sourceUrl: clip(getFirstString([adReply.sourceUrl, adReply.source_url])),
    sourceApp: clip(getFirstString([adReply.sourceApp, adReply.source_app])),
    sourceType: clip(getFirstString([adReply.sourceType, adReply.source_type])),
    mediaUrl: clip(getFirstString([adReply.mediaUrl, adReply.media_url])),
  };
}

function getCandidateMessage(root: Record<string, unknown>) {
  const data = getObject(root.data) || root;

  const directMessage = getObject(data.message) || getObject(root.message);
  if (directMessage) {
    return {
      envelope: data,
      key: getObject(data.key) || getObject(root.key),
      message: directMessage,
    };
  }

  const messageArray =
    (Array.isArray(data.messages) ? data.messages : null) ||
    (Array.isArray(root.messages) ? root.messages : null) ||
    (Array.isArray(getNested(root, ['data', 'messages'])) ? (getNested(root, ['data', 'messages']) as unknown[]) : null);

  if (messageArray && messageArray.length > 0) {
    const first = getObject(messageArray[0]);
    if (first) {
      return {
        envelope: first,
        key: getObject(first.key),
        message: getObject(first.message),
      };
    }
  }

  return {
    envelope: data,
    key: getObject(data.key) || getObject(root.key),
    message: null,
  };
}

export function parseEvolutionWebhookPayload(payload: unknown): ParsedEvolutionMessage | null {
  const root = getObject(payload);
  if (!root) return null;

  const event = getFirstString([
    root.event,
    root.type,
    getNested(root, ['data', 'event']),
    getNested(root, ['data', 'type']),
  ]);

  const candidate = getCandidateMessage(root);
  const providerMessageId = getFirstString([
    candidate.key?.id,
    candidate.envelope.id,
    root.id,
  ]);
  const quotedProviderMessageId = getFirstString([
    getNested(candidate.message, ['extendedTextMessage', 'contextInfo', 'stanzaId']),
    getNested(candidate.message, ['imageMessage', 'contextInfo', 'stanzaId']),
    getNested(candidate.message, ['videoMessage', 'contextInfo', 'stanzaId']),
    getNested(candidate.message, ['audioMessage', 'contextInfo', 'stanzaId']),
    getNested(candidate.message, ['documentMessage', 'contextInfo', 'stanzaId']),
    getNested(candidate.message, ['contextInfo', 'stanzaId']),
    getNested(candidate.envelope, ['contextInfo', 'stanzaId']),
  ]);

  const remoteJid = getFirstString([
    candidate.key?.remoteJid,
    candidate.envelope.remoteJid,
    candidate.envelope.jid,
    getNested(root, ['data', 'sender']),
    root.sender,
    root.from,
  ]);

  const messageType = inferMessageType(candidate.message, root.messageType);
  const content = extractContent(root, candidate.message);
  const fromMe = Boolean(candidate.key?.fromMe ?? candidate.envelope.fromMe ?? getNested(root, ['data', 'key', 'fromMe']));

  const contactPhone = normalizePhone(remoteJid);
  if (!contactPhone || !content) return null;

  return {
    event,
    providerMessageId,
    quotedProviderMessageId,
    direction: fromMe ? 'outbound' : 'inbound',
    messageType,
    content,
    contactName: getFirstString([
      candidate.envelope.pushName,
      getNested(root, ['data', 'pushName']),
      root.pushName,
      root.senderName,
    ]),
    contactPhone,
    sentAt: toIsoDate(
      candidate.envelope.messageTimestamp ??
        getNested(root, ['data', 'messageTimestamp']) ??
        root.messageTimestamp ??
        root.timestamp
    ),
    adClick: extractAdClick(candidate.envelope, candidate.message),
    raw: root,
  };
}
