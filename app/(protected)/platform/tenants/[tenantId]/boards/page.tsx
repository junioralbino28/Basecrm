'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const BoardsPage = dynamic(
  () => import('@/features/boards/BoardsPage').then((m) => ({ default: m.BoardsPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function PlatformTenantBoardsRoute() {
  return <BoardsPage />;
}
