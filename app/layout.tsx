import type { Metadata } from 'next'
import { Montserrat, Instrument_Serif, Plus_Jakarta_Sans, Fraunces } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister'
import { InstallBanner } from '@/components/pwa/InstallBanner'
import { StaleChunkGuard } from '@/components/pwa/StaleChunkGuard'
import { BRAND_THEME_BOOT_SCRIPT } from '@/lib/branding/brandTheme'

// Tema CENNO (padrão): Montserrat no corpo e nos títulos, Instrument Serif itálico nos destaques.
const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
})

const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
})

// Tema da clínica ([data-brand="clinica"]): Plus Jakarta Sans + Fraunces.
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
  title: 'CENNO CRM',
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
    <html
      lang="pt-BR"
      className={`dark ${montserrat.variable} ${instrument.variable} ${jakarta.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Repete o último tema de marca deste navegador antes da primeira pintura (sem piscar). */}
        <script dangerouslySetInnerHTML={{ __html: BRAND_THEME_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-[var(--color-bg)] text-[var(--color-text-primary)]">
        <ServiceWorkerRegister />
        <InstallBanner />
        <StaleChunkGuard />
        {children}
      </body>
    </html>
  )
}
