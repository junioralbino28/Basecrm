import {
  INBOUND_MEDIA_LABEL,
  type InboundMediaInfo,
  type InboundMediaKind,
  type InboundMediaMode,
} from './inboundMedia';

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
  /** Só vem preenchido com a chave de mídia da conexão ligada (`record` / `understand`). */
  media: InboundMediaInfo | null;
  /** Envelope desta mensagem (`key` + `message`), que a Evolution pede para baixar a mídia. */
  envelope: Record<string, unknown>;
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

const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
] as const;

/** Tira os embrulhos do WhatsApp (mensagem temporária, ver uma vez, documento com legenda). */
function unwrapMessage(message: Record<string, unknown> | null) {
  let current = message;
  let viewOnce = false;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const wrapper = MESSAGE_WRAPPERS.find((key) => getObject(getNested(current, [key, 'message'])));
    if (!wrapper) break;
    if (wrapper.startsWith('viewOnce')) viewOnce = true;
    current = getObject(getNested(current, [wrapper, 'message']));
  }
  return { message: current, viewOnce };
}

// Varredura de chaves CONHECIDAS, nunca `Object.keys(message)[0]`: a Evolution costuma mandar
// `messageContextInfo` na frente, e tipo desconhecido (reação, enquete, protocolo) segue descartado.
const MEDIA_KEYS: Array<[string, InboundMediaKind]> = [
  ['audioMessage', 'audio'],
  ['pttMessage', 'audio'],
  ['imageMessage', 'image'],
  ['stickerMessage', 'sticker'],
  ['videoMessage', 'video'],
  ['ptvMessage', 'video'],
  ['documentMessage', 'document'],
  ['locationMessage', 'location'],
  ['liveLocationMessage', 'location'],
  ['contactMessage', 'contact'],
  ['contactsArrayMessage', 'contact'],
];

const MIMETYPE_MAX_LENGTH = 100;

/** `fileLength` chega como número, texto ou Long do protobuf (`{ low, high }`). */
function toByteCount(value: unknown) {
  const long = getObject(value);
  const parsed = long
    ? Number(long.high ?? 0) * 2 ** 32 + (Number(long.low ?? 0) >>> 0)
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function detectMedia(message: Record<string, unknown> | null, viewOnce: boolean) {
  if (!message) return null;
  for (const [key, baseKind] of MEDIA_KEYS) {
    const body = getObject(message[key]);
    if (!body) continue;

    const seconds = typeof body.seconds === 'number' && Number.isFinite(body.seconds) && body.seconds >= 0
      ? Math.floor(body.seconds)
      : null;
    const mimetype = getFirstString([body.mimetype]);

    return {
      key,
      kind: (baseKind === 'video' && body.gifPlayback === true ? 'gif' : baseKind) as InboundMediaKind,
      mimetype: mimetype ? mimetype.replace(/[\r\n]+/g, ' ').slice(0, MIMETYPE_MAX_LENGTH) : null,
      seconds,
      fileLength: toByteCount(body.fileLength),
      isAnimated: body.isAnimated === true,
      isLottie: body.isLottie === true,
      viewOnce: viewOnce || body.viewOnce === true,
    };
  }
  return null;
}

const CONTACT_NAME_MAX_LENGTH = 80;

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

/**
 * `mediaMode` é a chave de mídia da conexão (`config.media.mode`). Com `off` (padrão) o parser faz
 * exatamente o que sempre fez: não desembrulha, não reconhece mídia e descarta mensagem sem texto.
 * Esse descarte é o que impede figurinha de virar contato, negócio ou resposta à régua em todos os
 * números; está travado em `evolutionWebhook.midiaOff.test.ts` e `route.post.test.ts`.
 */
export function parseEvolutionWebhookPayload(
  payload: unknown,
  options: { mediaMode?: InboundMediaMode } = {},
): ParsedEvolutionMessage | null {
  const mediaOn = (options.mediaMode ?? 'off') !== 'off';
  const root = getObject(payload);
  if (!root) return null;

  const event = getFirstString([
    root.event,
    root.type,
    getNested(root, ['data', 'event']),
    getNested(root, ['data', 'type']),
  ]);

  const candidate = getCandidateMessage(root);
  const unwrapped = mediaOn ? unwrapMessage(candidate.message) : { message: candidate.message, viewOnce: false };
  const message = unwrapped.message;
  const detectedMedia = mediaOn ? detectMedia(message, unwrapped.viewOnce) : null;

  const providerMessageId = getFirstString([
    candidate.key?.id,
    candidate.envelope.id,
    root.id,
  ]);
  const quotedProviderMessageId = getFirstString([
    getNested(message, ['extendedTextMessage', 'contextInfo', 'stanzaId']),
    getNested(message, ['imageMessage', 'contextInfo', 'stanzaId']),
    getNested(message, ['videoMessage', 'contextInfo', 'stanzaId']),
    getNested(message, ['audioMessage', 'contextInfo', 'stanzaId']),
    getNested(message, ['documentMessage', 'contextInfo', 'stanzaId']),
    getNested(message, ['contextInfo', 'stanzaId']),
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

  const messageType = detectedMedia ? detectedMedia.key : inferMessageType(message, root.messageType);
  const text = extractContent(root, message);
  // Mídia sem texto: `content` é `TEXT NOT NULL`, então entra o marcador curto. O selo de verdade
  // (tipo, duração, estado) vai em `metadata.media`, nunca no texto.
  const content = text ?? (detectedMedia ? INBOUND_MEDIA_LABEL[detectedMedia.kind] : null);
  const fromMe = Boolean(candidate.key?.fromMe ?? candidate.envelope.fromMe ?? getNested(root, ['data', 'key', 'fromMe']));

  const contactPhone = normalizePhone(remoteJid);
  if (!contactPhone || !content) return null;

  const pushName = getFirstString([
    candidate.envelope.pushName,
    getNested(root, ['data', 'pushName']),
    root.pushName,
    root.senderName,
  ]);

  return {
    event,
    providerMessageId,
    quotedProviderMessageId,
    direction: fromMe ? 'outbound' : 'inbound',
    messageType,
    content,
    // O nome do WhatsApp entra cru na linha do histórico que a IA lê: uma linha só, até 80 caracteres.
    contactName:
      mediaOn && pushName ? pushName.replace(/\s+/g, ' ').trim().slice(0, CONTACT_NAME_MAX_LENGTH) || null : pushName,
    contactPhone,
    sentAt: toIsoDate(
      candidate.envelope.messageTimestamp ??
        getNested(root, ['data', 'messageTimestamp']) ??
        root.messageTimestamp ??
        root.timestamp
    ),
    adClick: extractAdClick(candidate.envelope, message),
    media: detectedMedia
      ? {
          kind: detectedMedia.kind,
          mimetype: detectedMedia.mimetype,
          seconds: detectedMedia.seconds,
          fileLength: detectedMedia.fileLength,
          isAnimated: detectedMedia.isAnimated,
          isLottie: detectedMedia.isLottie,
          viewOnce: detectedMedia.viewOnce,
          placeholder: !text,
        }
      : null,
    envelope: candidate.envelope,
    raw: root,
  };
}
