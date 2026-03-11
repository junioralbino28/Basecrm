'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const DashboardPage = dynamic(
  () => import('@/features/dashboard/DashboardPage'),
  { loading: () => <PageLoader />, ssr: false }
);

export default function PlatformTenantDashboardRoute() {
  return <DashboardPage />;
}
