'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const VisaoGeralPage = dynamic(
  () => import('@/features/visao-geral/VisaoGeralPage'),
  { loading: () => <PageLoader />, ssr: false }
);

/**
 * Espelho tenant-scoped do /visao-geral (workspace de clínica da agência) —
 * o TenantContext resolve a org pela URL.
 */
export default function PlatformTenantVisaoGeralRoute() {
  return <VisaoGeralPage />;
}
