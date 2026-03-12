'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const UsersPage = dynamic(
  () => import('@/features/settings/UsersPage').then((m) => ({ default: m.UsersPage })),
  { loading: () => <PageLoader />, ssr: false }
)

export default function PlatformTeamPage() {
  return <UsersPage />
}

