'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const CallListPage = dynamic(
  () => import('@/features/call-list/CallListPage').then((m) => ({ default: m.CallListPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function PlatformTenantCallListRoute() {
  return <CallListPage />;
}
