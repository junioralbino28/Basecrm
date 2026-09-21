import type { InboundMediaInfo, InboundMediaKind } from '@/lib/conversations/inboundMedia';

/**
 * Quem entende cada tipo de mídia recebida (SPEC-midia-recebida v2, D3 e D4).
 *
 * Provedor e modelo ficam no CÓDIGO, não no config da conexão: o admin do cliente não pode abrir
 * uma porta de gasto com IA. A chave é sempre da organização dona da conexão, na coluna indicada
 * de `organization_settings`; faltou a chave, a mídia fica só com o selo (`skipped_no_key`). Nunca
 * se cai para chave de outra organização nem para variável de ambiente.
 *
 * Agnóstico de agente: vale para qualquer agente de IA que atenda pela conexão.
 */
export type MediaUnderstandingRoute = {
  provider: 'groq' | 'anthropic';
  model: string;
  keyColumn: 'ai_groq_key' | 'ai_anthropic_key';
  /** Teto sobre os bytes DECODIFICADOS. `seconds`/`fileLength` do payload são só pré-filtro. */
  maxBytes: number;
};

const AUDIO_MAX_BYTES = 1.5 * 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const ROUTES: Partial<Record<InboundMediaKind, MediaUnderstandingRoute>> = {
  // Escolha do Junior (21/09): Groq Whisper é o 1º candidato do teste prático. `large-v3` e não o
  // turbo: é o que tem medição independente em português e relato de mais consistência em pt-BR.
  audio: { provider: 'groq', model: 'whisper-large-v3', keyColumn: 'ai_groq_key', maxBytes: AUDIO_MAX_BYTES },
  image: { provider: 'anthropic', model: 'claude-sonnet-5', keyColumn: 'ai_anthropic_key', maxBytes: IMAGE_MAX_BYTES },
  sticker: { provider: 'anthropic', model: 'claude-sonnet-5', keyColumn: 'ai_anthropic_key', maxBytes: IMAGE_MAX_BYTES },
};

/**
 * Devolve a rota de entendimento, ou `null` quando a mídia fica só com o selo:
 * - ver uma vez: o remetente pediu que sumisse, não é desembrulhada para descrição;
 * - figurinha animada ou Lottie: não é imagem estática (v1 não extrai quadro);
 * - GIF: precisa de modelo que leia vídeo com chave Google paga (a da organização de teste é gratuita);
 * - vídeo, documento, localização e contato: fora da v1.
 */
export function resolveMediaUnderstandingRoute(media: Pick<InboundMediaInfo, 'kind' | 'viewOnce' | 'isAnimated' | 'isLottie'>) {
  if (media.viewOnce) return null;
  if (media.kind === 'sticker' && (media.isAnimated || media.isLottie)) return null;
  return ROUTES[media.kind] ?? null;
}
