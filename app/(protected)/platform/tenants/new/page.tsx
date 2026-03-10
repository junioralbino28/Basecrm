'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const NewTenantPage = dynamic(
  () => import('@/features/platform/tenants/NewTenantPage').then((m) => ({ default: m.NewTenantPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function NewTenant() {
  return <NewTenantPage />;
}
