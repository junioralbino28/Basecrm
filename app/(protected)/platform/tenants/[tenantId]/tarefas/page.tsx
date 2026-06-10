'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const TarefasPage = dynamic(
  () => import('@/features/tarefas/TarefasPage').then((m) => ({ default: m.TarefasPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function PlatformTenantTarefasRoute() {
  return <TarefasPage />;
}
