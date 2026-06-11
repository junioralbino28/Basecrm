'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const AgendaPage = dynamic(
    () => import('@/features/agenda/AgendaPage').then(m => ({ default: m.AgendaPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function Agenda() {
    return <AgendaPage />
}
