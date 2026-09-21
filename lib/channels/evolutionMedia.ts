import { assertSafeEvolutionUrl, isEvolutionUrlRejected } from './evolutionUrlGuard';

/**
 * Download de mídia recebida pela Evolution (SPEC-midia-recebida v2, Passo 2).
 *
 * O CRM nunca busca `url`/`directPath` do payload do WhatsApp: quem baixa e decripta é a Evolution,
 * no endereço já validado da conexão (G26). A resposta é lida EM FLUXO e abortada ao passar do teto,
 * porque `seconds` e `fileLength` do payload são declarados pelo remetente e podem mentir (G18).
 */

export type EvolutionMediaDownloadFailure =
  | 'url_rejected'
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'too_large'
  | 'invalid_response'
  | 'empty';

export type EvolutionMediaDownloadResult =
  | { ok: true; bytes: Uint8Array; mimetype: string | null; fileName: string | null; attempts: number }
  | { ok: false; reason: EvolutionMediaDownloadFailure; status?: number; attempts: number };

/** Teto absoluto da resposta JSON da Evolution (base64 de 8 MB = ~10,7 MB, mais folga). */
export const EVOLUTION_MEDIA_RESPONSE_MAX_BYTES = 12 * 1024 * 1024;
const BASE64_ENVELOPE_SLACK_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 2;

function clip(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : null;
}

async function readBodyUpTo(response: Response, maxBytes: number): Promise<Uint8Array | 'too_large'> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return 'too_large';
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function downloadEvolutionMedia(params: {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  /** Lista fechada montada pelo parser: chave da mensagem + só o corpo da mídia. */
  envelope: { key: Record<string, unknown>; message: Record<string, unknown> };
  /** Teto sobre os bytes DECODIFICADOS (áudio 1,5 MB; imagem, figurinha e GIF 8 MB). */
  maxBytes: number;
  timeoutMs?: number;
  attempts?: number;
  fetchImpl?: typeof fetch;
}): Promise<EvolutionMediaDownloadResult> {
  const doFetch = params.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, params.attempts ?? DEFAULT_ATTEMPTS);
  const responseMaxBytes = Math.min(
    EVOLUTION_MEDIA_RESPONSE_MAX_BYTES,
    Math.ceil((params.maxBytes * 4) / 3) + BASE64_ENVELOPE_SLACK_BYTES,
  );

  try {
    await assertSafeEvolutionUrl(params.apiUrl);
  } catch (error) {
    if (isEvolutionUrlRejected(error)) return { ok: false, reason: 'url_rejected', attempts: 0 };
    throw error;
  }
  const endpoint = `${params.apiUrl.replace(/\/+$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(params.instanceName)}`;

  let last: EvolutionMediaDownloadResult = { ok: false, reason: 'network', attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await downloadOnce(attempt);
    // Só vale tentar de novo o que pode ser passageiro; arquivo grande ou resposta inválida não muda.
    const transient = !last.ok && (last.reason === 'timeout' || last.reason === 'network' || (last.reason === 'http_error' && (last.status ?? 0) >= 500));
    if (!transient) return last;
  }
  return last;

  async function downloadOnce(attempt: number): Promise<EvolutionMediaDownloadResult> {
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: params.apiKey },
        body: JSON.stringify({ message: params.envelope, convertToMp4: false }),
        redirect: 'error',
        signal: AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', attempts: attempt };
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'http_error', status: response.status, attempts: attempt };
    }

    let body: Uint8Array | 'too_large';
    try {
      body = await readBodyUpTo(response, responseMaxBytes);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', attempts: attempt };
    }
    if (body === 'too_large') return { ok: false, reason: 'too_large', attempts: attempt };

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return { ok: false, reason: 'invalid_response', attempts: attempt };
    }
    // A Evolution responde `null` quando não consegue decriptar (figurinha: issue #1206).
    const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    if (!source || typeof source.base64 !== 'string') return { ok: false, reason: 'invalid_response', attempts: attempt };

    const bytes = new Uint8Array(Buffer.from(source.base64, 'base64'));
    if (bytes.byteLength === 0) return { ok: false, reason: 'empty', attempts: attempt };
    if (bytes.byteLength > params.maxBytes) return { ok: false, reason: 'too_large', attempts: attempt };

    return { ok: true, bytes, mimetype: clip(source.mimetype, 100), fileName: clip(source.fileName, 160), attempts: attempt };
  }
}
