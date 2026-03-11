'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const ReportsPage = dynamic(
  () => import('@/features/reports/ReportsPage'),
  { loading: () => <PageLoader />, ssr: false }
);

export default function PlatformTenantReportsRoute() {
  return <ReportsPage />;
}
