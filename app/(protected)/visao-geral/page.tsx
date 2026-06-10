'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const VisaoGeralPage = dynamic(
    () => import('@/features/visao-geral/VisaoGeralPage'),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Rota /visao-geral — o mês da clínica num olhar (N5).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function VisaoGeral() {
    return <VisaoGeralPage />
}
