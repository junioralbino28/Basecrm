'use client';

import React from 'react';
import { ArrowDown, Check, CheckCheck, FileText, Loader2, Play } from 'lucide-react';
import { dealFilesService } from '@/lib/supabase/dealFiles';
import type {
  ConversationMessage,
  ConversationMessageDirection,
  ConversationMessageMetadata,
} from '@/lib/conversations/types';

// Waveform "fake" (estático) do mockup — barras de altura variada. É decorativo;
// o player real toca o áudio assinado. Alturas fixas pra não recalcular layout.
const WAVE_HEIGHTS = [2, 4, 3, 5, 2, 4, 6, 3, 2, 4, 5, 2, 3, 5, 2, 4];

type AttachmentMeta = {
  kind: 'image' | 'video' | 'document' | 'audio';
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
};

/** Lê o anexo da metadata da mensagem (enviada pelo nosso route) OU infere do message_type. */
function readAttachment(message: ConversationMessage): AttachmentMeta | null {
  const meta = (message.metadata || {}) as ConversationMessageMetadata & {
    attachment?: Partial<AttachmentMeta>;
  };
  const att = meta.attachment;
  if (att && typeof att.kind === 'string' && typeof att.file_path === 'string') {
    return {
      kind: att.kind as AttachmentMeta['kind'],
      file_path: att.file_path,
      file_name: att.file_name ?? null,
      mime_type: att.mime_type ?? null,
      file_size: att.file_size ?? null,
    };
  }
  return null;
}

/** Tipo de mídia recebida (sem anexo nosso) inferido do message_type do WhatsApp. */
function inboundMediaKind(messageType: string): AttachmentMeta['kind'] | null {
  if (messageType === 'imageMessage') return 'image';
  if (messageType === 'videoMessage') return 'video';
  if (messageType === 'documentMessage') return 'document';
  if (messageType === 'audioMessage' || messageType === 'pttMessage') return 'audio';
  return null;
}

function DeliveryTicks({
  meta,
  direction,
}: {
  meta: ConversationMessageMetadata;
  direction: ConversationMessageDirection;
}) {
  if (direction !== 'outbound') return null;
  if (meta.delivery_status === 'failed') {
    return <span className="text-[10px] font-semibold text-rose-500">falhou</span>;
  }
  if (meta.delivery_status === 'sent') {
    return <CheckCheck className="h-3.5 w-3.5 text-brand-500" />;
  }
  return <Check className="h-3.5 w-3.5 text-slate-400" />;
}

function useSignedUrl(filePath: string | null) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!filePath || url) return url;
    setLoading(true);
    try {
      const { url: signed } = await dealFilesService.getDownloadUrl(filePath);
      setUrl(signed);
      return signed;
    } finally {
      setLoading(false);
    }
  }, [filePath, url]);

  return { url, loading, load };
}

function AudioBubble({ filePath }: { filePath: string }) {
  const { url, loading, load } = useSignedUrl(filePath);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  async function handlePlay() {
    const signed = url || (await load());
    if (!signed) return;
    requestAnimationFrame(() => {
      audioRef.current?.play().catch(() => undefined);
    });
  }

  return (
    <div className="flex w-60 items-center gap-2.5">
      <button
        type="button"
        onClick={handlePlay}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
        aria-label="Tocar áudio"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="flex h-6 flex-1 items-center gap-[2px]">
        {WAVE_HEIGHTS.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-brand-200"
            style={{ height: `${h * 4}px` }}
          />
        ))}
      </div>
      <audio ref={audioRef} src={url || undefined} preload="none" className="hidden" />
    </div>
  );
}

function DocumentBubble({ attachment }: { attachment: AttachmentMeta }) {
  const { url, loading, load } = useSignedUrl(attachment.file_path);

  async function handleDownload() {
    const signed = url || (await load());
    if (!signed) return;
    const a = document.createElement('a');
    a.href = signed;
    a.download = attachment.file_name || 'arquivo';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const sizeLabel = attachment.file_size
    ? dealFilesService.formatFileSize(attachment.file_size)
    : null;
  const ext = (attachment.file_name?.split('.').pop() || attachment.kind).toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-rose-50 text-rose-600">
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium text-ink">
          {attachment.file_name || 'Documento'}
        </div>
        <div className="text-[10px] text-faint">{[sizeLabel, ext].filter(Boolean).join(' · ')}</div>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:bg-line/50"
        aria-label="Baixar documento"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDown className="h-4 w-4" />}
      </button>
    </div>
  );
}

function ImageBubble({ attachment }: { attachment: AttachmentMeta }) {
  const { url, load } = useSignedUrl(attachment.file_path);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!url) {
    return (
      <div className="grid h-40 w-56 place-items-center rounded-xl bg-surface text-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={attachment.file_name || 'Imagem'}
      className="max-h-64 w-56 rounded-xl object-cover"
    />
  );
}

/**
 * Bolha de mensagem estilo WhatsApp (light-first, tokens da marca).
 * - texto: prosa com check-check
 * - documento: card com download
 * - áudio: player + waveform
 * - imagem: thumbnail assinado
 * Recebida (sem anexo nosso) infere o tipo pelo message_type do WhatsApp; quando
 * não há file_path (mídia inbound sem download local), cai pro rótulo + caption.
 */
export const MessageBubble: React.FC<{ message: ConversationMessage }> = ({ message }) => {
  const meta = (message.metadata || {}) as ConversationMessageMetadata;
  const direction = message.direction;
  const attachment = readAttachment(message);
  const inboundKind = attachment ? null : inboundMediaKind(message.message_type);

  const time = new Date(message.sent_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isInternal = direction === 'internal';
  const isOutbound = direction === 'outbound';

  const align = isInternal ? 'justify-center' : isOutbound ? 'justify-end' : 'justify-start';
  // O chat é dark-fixo (estilo WhatsApp). Os balões usam cores FIXAS estilo "modo claro"
  // pra ficarem legíveis nos dois temas — o inbound usava `bg-card`/`text-ink` (tokens do
  // tema), que no dark viravam marrom-escuro sobre o fundo escuro e sumiam.
  const bubbleTone = isInternal
    ? 'bg-gold-50 border border-gold-100 text-slate-800'
    : isOutbound
      ? 'bg-brand-50 border border-brand-100 text-slate-900 rounded-tr-md'
      : 'bg-white border border-slate-200 text-slate-900 rounded-tl-md';

  const captionText = attachment
    ? message.content && message.content !== attachment.file_name && message.content !== `[${attachment.kind}]`
      ? message.content
      : ''
    : message.content;

  return (
    <div className={`flex ${align}`}>
      <div className={`max-w-[72%] rounded-2xl px-3.5 py-2.5 shadow-soft ${bubbleTone}`}>
        {isInternal ? (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-700">
            Nota interna · {message.author_name || 'Equipe'}
          </div>
        ) : null}

        {attachment?.kind === 'audio' ? (
          <AudioBubble filePath={attachment.file_path} />
        ) : attachment?.kind === 'document' || attachment?.kind === 'video' ? (
          <DocumentBubble attachment={attachment} />
        ) : attachment?.kind === 'image' ? (
          <ImageBubble attachment={attachment} />
        ) : inboundKind ? (
          <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-[12.5px] font-medium text-muted">
            <FileText className="h-4 w-4 shrink-0" />
            {inboundKind === 'audio' ? 'Áudio recebido' : `Mídia recebida (${inboundKind})`}
          </div>
        ) : null}

        {captionText ? (
          <p className={`whitespace-pre-wrap text-[13.5px] ${attachment || inboundKind ? 'mt-2' : ''}`}>
            {captionText}
          </p>
        ) : null}

        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
          {time}
          <DeliveryTicks meta={meta} direction={direction} />
        </div>

        {meta.delivery_error ? (
          <div className="mt-2 rounded-lg bg-rose-50 px-2 py-1 text-[10px] text-rose-600">
            Falha no envio: {String(meta.delivery_error)}
          </div>
        ) : null}
      </div>
    </div>
  );
};
