'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const TenantWorkspacePage = dynamic(
  () => import('@/features/platform/tenants/TenantWorkspacePage').then((m) => ({ default: m.TenantWorkspacePage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function TenantWorkspace() {
  return <TenantWorkspacePage />;
}
