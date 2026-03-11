'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const ActivitiesPage = dynamic(
  () => import('@/features/activities/ActivitiesPage').then((m) => ({ default: m.ActivitiesPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function PlatformTenantActivitiesRoute() {
  return <ActivitiesPage />;
}
