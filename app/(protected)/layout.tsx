'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { QueryProvider } from '@/lib/query'
import { ToastProvider } from '@/context/ToastContext'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { CRMProvider } from '@/context/CRMContext'
import { AIProvider } from '@/context/AIContext'
import { TenantProvider, useTenant } from '@/context/TenantContext'
import { isClinicRole } from '@/lib/auth/scope'
import { applyBrandTheme, resolveBrandTheme } from '@/lib/branding/brandTheme'
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
 * Pinta o tema de marca da organização do usuário (`<html data-brand>`): agência vê CENNO,
 * cliente vê o tema declarado em branding_config.brandTheme. Regra em lib/branding/brandTheme.ts.
 */
function BrandThemeApplier() {
    const { profile } = useAuth()
    const { tenant, loading } = useTenant()
    const brandTheme = resolveBrandTheme({
        role: profile?.role,
        tenantLoaded: !loading,
        brandingConfig: tenant?.brandingConfig,
    })

    useEffect(() => {
        if (brandTheme) applyBrandTheme(brandTheme)
    }, [brandTheme])

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
                            <BrandThemeApplier />
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

