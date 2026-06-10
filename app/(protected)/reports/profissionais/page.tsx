'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const ProfessionalsReportPage = dynamic(
    () => import('@/features/reports/ProfessionalsReportPage'),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Rota /reports/profissionais — comissão paga vs a pagar (F8/adendo, só admin).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Profissionais() {
    return <ProfessionalsReportPage />
}
