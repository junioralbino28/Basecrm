'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const TenantBrandingPage = dynamic(
  () => import('@/features/platform/tenants/TenantBrandingPage').then((m) => ({ default: m.TenantBrandingPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function BrandingPage() {
  return <TenantBrandingPage />;
}
