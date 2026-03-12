 'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const BoardsPage = dynamic(
    () => import('@/features/boards/BoardsPage').then(m => ({ default: m.BoardsPage })),
    { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `Boards`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Boards() {
    return <BoardsPage />
}
