'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { QueryProvider } from '@/lib/query'
import { ToastProvider } from '@/context/ToastContext'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { CRMProvider } from '@/context/CRMContext'
import { AIProvider } from '@/context/AIContext'
import { TenantProvider } from '@/context/TenantContext'
import { isClinicRole } from '@/lib/auth/scope'
import Layout from '@/components/Layout'

/**
 * Aplica o tema default por role: usuários de clínica (clinic_admin/clinic_staff/
 * vendedor) nascem no tema CLARO (mockup é light-first). Só age quando não há
 * preferência salva — o toggle do usuário continua mandando. Agência mantém dark.
 */
function ThemeRoleDefault() {
    const { profile } = useAuth()
    const { applyRoleDefault } = useTheme()

    useEffect(() => {
        if (!profile?.role) return
        if (isClinicRole(profile.role)) applyRoleDefault(false)
    }, [profile?.role, applyRoleDefault])

    return null
}

/**
 * Componente React `ProtectedLayout`.
 *
 * @param {{ children: ReactNode; }} {
    children,
} - Parâmetro `{
    children,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function ProtectedLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const isSetupRoute = pathname === '/setup'
    const isLabsRoute = pathname === '/labs' || pathname.startsWith('/labs/')
    const shouldUseAppShell = !isSetupRoute && !isLabsRoute

    // #region agent log
    useEffect(() => {
      if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
        const detectEnv = async () => {
          const env = {
            userAgent: navigator.userAgent,
            isCursorBrowser: navigator.userAgent.includes('Cursor') || window.location.hostname === 'localhost',
            hasServiceWorker: 'serviceWorker' in navigator,
            serviceWorkerReady: false,
            cacheAvailable: 'caches' in window,
            devToolsOpen: false,
            reactDevTools: !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__,
            localStorageAvailable: typeof Storage !== 'undefined',
            sessionStorageAvailable: typeof sessionStorage !== 'undefined',
          };

          // Check service worker
          if (env.hasServiceWorker) {
            try {
              const registration = await navigator.serviceWorker.getRegistration();
              env.serviceWorkerReady = !!registration;
            } catch {}
          }

          // Detect DevTools (heuristic)
          let devtools = false;
          const threshold = 160;
          const widthThreshold = window.outerWidth - window.innerWidth > threshold;
          const heightThreshold = window.outerHeight - window.innerHeight > threshold;
          devtools = widthThreshold || heightThreshold;
          env.devToolsOpen = devtools;

          fetch('http://127.0.0.1:7242/ingest/d70f541c-09d7-4128-9745-93f15f184017',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'env-detect',hypothesisId:'ENV1',location:'app/(protected)/layout.tsx:ProtectedLayout',message:'Environment detection',data:env,timestamp:Date.now()})}).catch(()=>{});
        };
        detectEnv();
      }
    }, [pathname]);
    // #endregion

    return (
        <QueryProvider>
            <ToastProvider>
                <ThemeProvider>
                    <AuthProvider>
                        <ThemeRoleDefault />
                        <TenantProvider>
                            <CRMProvider>
                                <AIProvider>
                                    {shouldUseAppShell ? <Layout>{children}</Layout> : children}
                                </AIProvider>
                            </CRMProvider>
                        </TenantProvider>
                    </AuthProvider>
                </ThemeProvider>
            </ToastProvider>
        </QueryProvider>
    )
}

