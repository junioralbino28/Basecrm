'use client';

import { useEffect } from 'react';

/**
 * Guarda contra "aba velha": quando o servidor recompila (dev/HMR) ou um deploy
 * troca os assets, uma aba aberta há tempo tenta carregar chunks que não
 * existem mais — cliques passam a dar erro e mutações somem silenciosamente
 * (dor recorrente do C2C: "funções que quando clico dá erro").
 *
 * Detecta os erros clássicos de chunk/módulo obsoleto e recarrega a página UMA
 * vez (trava de 30s em sessionStorage impede loop se o reload não resolver).
 */
const RELOAD_FLAG = 'stale-chunk-reload-at';
const RELOAD_COOLDOWN_MS = 30_000;

const STALE_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [^\s]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

function isStaleAssetError(message: string): boolean {
  return STALE_PATTERNS.some((pattern) => pattern.test(message));
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage indisponível: recarrega mesmo assim (pior caso = F5 manual).
  }
  window.location.reload();
}

export function StaleChunkGuard() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message = event.message || String(event.error?.message || '');
      if (isStaleAssetError(message)) reloadOnce();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        typeof reason === 'string'
          ? reason
          : String((reason as { message?: string } | null)?.message || '');
      const name = String((reason as { name?: string } | null)?.name || '');
      if (isStaleAssetError(message) || name === 'ChunkLoadError') reloadOnce();
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
