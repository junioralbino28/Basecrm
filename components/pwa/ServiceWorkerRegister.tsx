'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const pwaEnabled = process.env.NEXT_PUBLIC_ENABLE_PWA === 'true';

    // Default: disable PWA cache for web CRM to avoid stale UI/code flashes.
    // If someone enables PWA explicitly, registration continues below.
    if (!pwaEnabled) {
      const cleanup = async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((reg) => reg.unregister()));
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(
              keys
                .filter((k) => k.startsWith('nossocrm-shell'))
                .map((k) => caches.delete(k))
            );
          }
        } catch {
          // noop: cleanup is best-effort
        }
      };
      void cleanup();
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');

        // Monitor service worker updates
        registration.addEventListener('updatefound', () => {
        });

        // Check for existing service worker
        if (registration.active) {
        }
      } catch (err) {
        // #region agent log
        if (process.env.NODE_ENV !== 'production') {
          const errMsg = (err instanceof Error ? err.message : String(err || '')).slice(0, 120);
        }
        // #endregion
        // noop (PWA is best-effort)
      }
    };

    register();
  }, []);

  return null;
}

