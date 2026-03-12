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
        // #region agent log
        if (process.env.NODE_ENV !== 'production') {
          fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'sw-register',hypothesisId:'SW1',location:'components/pwa/ServiceWorkerRegister.tsx:register',message:'Service Worker registered',data:{scope:registration.scope,active:!!registration.active,installing:!!registration.installing,waiting:!!registration.waiting},timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion

        // Monitor service worker updates
        registration.addEventListener('updatefound', () => {
          // #region agent log
          if (process.env.NODE_ENV !== 'production') {
            fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'sw-update',hypothesisId:'SW2',location:'components/pwa/ServiceWorkerRegister.tsx:updatefound',message:'Service Worker update found',data:{scope:registration.scope},timestamp:Date.now()})}).catch(()=>{});
          }
          // #endregion
        });

        // Check for existing service worker
        if (registration.active) {
          // #region agent log
          if (process.env.NODE_ENV !== 'production') {
            fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'sw-active',hypothesisId:'SW3',location:'components/pwa/ServiceWorkerRegister.tsx:register',message:'Service Worker already active',data:{scope:registration.scope,state:registration.active.state},timestamp:Date.now()})}).catch(()=>{});
          }
          // #endregion
        }
      } catch (err) {
        // #region agent log
        if (process.env.NODE_ENV !== 'production') {
          const errMsg = (err instanceof Error ? err.message : String(err || '')).slice(0, 120);
          fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'sw-error',hypothesisId:'SW4',location:'components/pwa/ServiceWorkerRegister.tsx:register',message:'Service Worker registration error',data:{errMsg},timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion
        // noop (PWA is best-effort)
      }
    };

    register();
  }, []);

  return null;
}

