'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const AtendimentosPage = dynamic(
    () => import('@/features/atendimentos/AtendimentosPage').then(m => ({ default: m.AtendimentosPage })),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `Atendimentos`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Atendimentos() {
    return <AtendimentosPage />
}
