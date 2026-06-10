import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Fraunces } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister'
import { InstallBanner } from '@/components/pwa/InstallBanner'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz'],
})

export const metadata: Metadata = {
  title: 'Base CRM',
  description: 'CRM Inteligente para Gestão de Vendas',
}

/**
 * Componente React `RootLayout`.
 *
 * @param {{ children: ReactNode; }} {
  children,
} - Parâmetro `{
  children,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={`dark ${jakarta.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased bg-[var(--color-bg)] text-[var(--color-text-primary)]">
        <ServiceWorkerRegister />
        <InstallBanner />
        {children}
      </body>
    </html>
  )
}
