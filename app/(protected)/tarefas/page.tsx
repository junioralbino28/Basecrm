'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const TarefasPage = dynamic(
    () => import('@/features/tarefas/TarefasPage').then(m => ({ default: m.TarefasPage })),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Rota protegida /tarefas — tela "Tarefas & lembretes" (N2).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Tarefas() {
    return <TarefasPage />
}
