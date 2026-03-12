'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const SettingsPage = dynamic(
  () => import('@/features/settings/SettingsPage'),
  { loading: () => <PageLoader />, ssr: false }
)

export default function SettingsUsersPage() {
  return <SettingsPage tab="users" />
}

