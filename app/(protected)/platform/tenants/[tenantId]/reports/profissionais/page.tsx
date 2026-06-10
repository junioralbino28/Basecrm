'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const ProfessionalsReportPage = dynamic(
  () => import('@/features/reports/ProfessionalsReportPage'),
  { loading: () => <PageLoader />, ssr: false }
);

/**
 * Espelho tenant-scoped do /reports/profissionais (workspace de clínica da
 * agência) — o TenantContext resolve a org pela URL e o RPC valida
 * can_configure_organization na org pedida.
 */
export default function PlatformTenantProfissionaisRoute() {
  return <ProfessionalsReportPage />;
}
