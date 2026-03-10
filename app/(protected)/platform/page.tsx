'use client'

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const PlatformPage = dynamic(
  () => import('@/features/platform/PlatformPage').then((m) => ({ default: m.PlatformPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export default function Platform() {
  return <PlatformPage />;
}
