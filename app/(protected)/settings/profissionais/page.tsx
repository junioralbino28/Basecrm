'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const SettingsPage = dynamic(
  () => import('@/features/settings/SettingsPage'),
  { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `SettingsProfissionais`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function SettingsProfissionais() {
  return <SettingsPage tab="professionals" />
}
