'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const FinanceReportPage = dynamic(
    () => import('@/features/reports/FinanceReportPage'),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Rota /reports/financeiro — relatório financeiro (F8, só admin).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Financeiro() {
    return <FinanceReportPage />
}
