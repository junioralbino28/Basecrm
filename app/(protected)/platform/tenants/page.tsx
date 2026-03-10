'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const TenantsPage = dynamic(
  () => import('@/features/platform/tenants/TenantsPage').then((m) => ({ default: m.TenantsPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function Tenants() {
  return <TenantsPage />;
}
