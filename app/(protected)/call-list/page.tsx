'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const CallListPage = dynamic(
    () => import('@/features/call-list/CallListPage').then(m => ({ default: m.CallListPage })),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Rota protegida /call-list — Home "Hoje" / call-list (F6, "quem ligar hoje").
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function CallList() {
    return <CallListPage />
}
