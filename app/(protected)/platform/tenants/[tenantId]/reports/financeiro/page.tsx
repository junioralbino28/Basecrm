'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const FinanceReportPage = dynamic(
  () => import('@/features/reports/FinanceReportPage'),
  { loading: () => <PageLoader />, ssr: false }
);

/**
 * Espelho tenant-scoped do /reports/financeiro (workspace de clínica da
 * agência) — o TenantContext resolve a org pela URL e o RPC valida
 * can_configure_organization na org pedida.
 */
export default function PlatformTenantFinanceiroRoute() {
  return <FinanceReportPage />;
}
