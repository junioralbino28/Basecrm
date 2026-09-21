/**
 * Mídia recebida pelo WhatsApp (SPEC-midia-recebida v2).
 *
 * Módulo puro, agnóstico de agente e seguro para o navegador: os tipos, a chave por conexão e o
 * texto do selo do balão. Tudo aqui é montado a partir de `metadata.media`, que só o servidor
 * escreve; nunca a partir do `content`, para o lead não conseguir forjar "[áudio transcrito]".
 */

/** `config.media.mode` da conexão. Ausente ou inválido = `off` (comportamento de sempre). */
export type InboundMediaMode = 'off' | 'record' | 'understand';

export type InboundMediaKind =
  | 'audio'
  | 'image'
  | 'sticker'
  | 'gif'
  | 'video'
  | 'document'
  | 'location'
  | 'contact';

export type InboundMediaStatus =
  | 'recorded'
  | 'pending'
  | 'done'
  | 'empty'
  | 'failed'
  | 'timeout'
  | 'limit'
  | 'skipped_no_key';

export type InboundMediaInfo = {
  kind: InboundMediaKind;
  mimetype: string | null;
  seconds: number | null;
  fileLength: number | null;
  isAnimated: boolean;
  isLottie: boolean;
  viewOnce: boolean;
  /** `true` quando o `content` da mensagem é só o marcador ("Áudio", "Figurinha"…), sem texto do lead. */
  placeholder: boolean;
};

export type InboundMediaMetadata = InboundMediaInfo & {
  status: InboundMediaStatus;
  /** Descrição automática guardada à parte, quando o `content` é a legenda que o lead digitou. */
  description?: string | null;
};

export const INBOUND_MEDIA_LABEL: Record<InboundMediaKind, string> = {
  audio: 'Áudio',
  image: 'Imagem',
  sticker: 'Figurinha',
  gif: 'GIF',
  video: 'Vídeo',
  document: 'Documento',
  location: 'Localização',
  contact: 'Contato',
};

const STATUSES: InboundMediaStatus[] = ['recorded', 'pending', 'done', 'empty', 'failed', 'timeout', 'limit', 'skipped_no_key'];

export function resolveInboundMediaMode(config: Record<string, unknown> | null | undefined): InboundMediaMode {
  const media = config?.media;
  if (!media || typeof media !== 'object' || Array.isArray(media)) return 'off';
  const mode = (media as Record<string, unknown>).mode;
  return mode === 'record' || mode === 'understand' ? mode : 'off';
}

/** Lê `metadata.media` de uma mensagem vinda do banco. Qualquer coisa fora do formato = sem selo. */
export function readInboundMediaMetadata(metadata: unknown): InboundMediaMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const media = (metadata as Record<string, unknown>).media;
  if (!media || typeof media !== 'object' || Array.isArray(media)) return null;
  const source = media as Record<string, unknown>;
  if (typeof source.kind !== 'string' || !Object.prototype.hasOwnProperty.call(INBOUND_MEDIA_LABEL, source.kind)) return null;

  const status = STATUSES.includes(source.status as InboundMediaStatus) ? (source.status as InboundMediaStatus) : 'recorded';
  const toNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

  return {
    kind: source.kind as InboundMediaKind,
    mimetype: typeof source.mimetype === 'string' ? source.mimetype : null,
    seconds: toNumber(source.seconds),
    fileLength: toNumber(source.fileLength),
    isAnimated: source.isAnimated === true,
    isLottie: source.isLottie === true,
    viewOnce: source.viewOnce === true,
    placeholder: source.placeholder === true,
    status,
    ...(typeof source.description === 'string' && source.description.trim() ? { description: source.description } : {}),
  };
}

function formatSeconds(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Texto do selo do balão. `tone: 'warning'` = o humano precisa olhar o aparelho. */
export function describeInboundMediaBadge(media: InboundMediaMetadata): {
  label: string;
  note: string | null;
  tone: 'neutral' | 'warning';
} {
  const timed = media.kind === 'audio' || media.kind === 'video' || media.kind === 'gif';
  const label = [
    INBOUND_MEDIA_LABEL[media.kind],
    timed && media.seconds !== null ? formatSeconds(media.seconds) : null,
    media.viewOnce ? 'visualização única' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const isAudio = media.kind === 'audio';
  const onDevice = isAudio ? 'ouça no aparelho' : 'veja no aparelho';

  switch (media.status) {
    case 'pending':
      return { label, note: 'entendendo…', tone: 'neutral' };
    case 'done':
      return { label, note: `${isAudio ? 'transcrição' : 'descrição'} automática, pode conter erro`, tone: 'neutral' };
    case 'empty':
      return { label, note: `sem fala reconhecível: ${onDevice}`, tone: 'warning' };
    case 'failed':
    case 'timeout':
      return { label, note: `${isAudio ? 'não transcrito' : 'não descrito'}: ${onDevice}`, tone: 'warning' };
    case 'limit':
      return { label, note: `limite de mídia atingido: ${onDevice}`, tone: 'warning' };
    case 'skipped_no_key':
      return { label, note: `sem chave de IA para esta mídia: ${onDevice}`, tone: 'warning' };
    case 'recorded':
    default:
      return { label, note: media.placeholder ? onDevice : null, tone: 'neutral' };
  }
}
