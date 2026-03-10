'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const TenantDomainsPage = dynamic(
  () => import('@/features/platform/tenants/TenantDomainsPage').then((m) => ({ default: m.TenantDomainsPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function DomainsPage() {
  return <TenantDomainsPage />;
}
