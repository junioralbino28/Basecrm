import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useSearchParams: () => ({
    get: () => null,
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('./hooks/useSettingsController', () => ({
  useSettingsController: () => ({
    defaultRoute: '/boards',
    setDefaultRoute: vi.fn(),

    customFieldDefinitions: [],
    newFieldLabel: '',
    setNewFieldLabel: vi.fn(),
    newFieldType: 'text',
    setNewFieldType: vi.fn(),
    newFieldOptions: '',
    setNewFieldOptions: vi.fn(),
    editingId: null,
    startEditingField: vi.fn(),
    cancelEditingField: vi.fn(),
    handleSaveField: vi.fn(),
    removeCustomField: vi.fn(),

    availableTags: ['VIP'],
    newTagName: '',
    setNewTagName: vi.fn(),
    handleAddTag: vi.fn(),
    removeTag: vi.fn(),
  }),
}))

// Evita depender de providers (Toast/Supabase) — isola o roteamento de abas do data layer.
vi.mock('./components/ApiKeysSection', () => ({ ApiKeysSection: () => <div>API</div> }))
vi.mock('./components/WebhooksSection', () => ({ WebhooksSection: () => <div>Webhooks</div> }))
vi.mock('./components/McpSection', () => ({ McpSection: () => <div>MCP</div> }))

// Managers financeiros: stubs para isolar o roteamento de sub-tabs.
vi.mock('./components/CardFeesManager', () => ({
  CardFeesManager: () => <h3>Taxas de Pagamento</h3>,
}))
vi.mock('./components/CommissionsManager', () => ({
  CommissionsManager: () => <h3>Comissões</h3>,
}))
vi.mock('./components/FixedCostsManager', () => ({
  FixedCostsManager: () => <h3>Contas Fixas</h3>,
}))

import SettingsPage from './SettingsPage'
import { useAuth } from '@/context/AuthContext'

const useAuthMock = vi.mocked(useAuth)

describe('SettingsPage RBAC — aba financeiro (gate do Adel)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clinic_staff NÃO vê a aba financeiro', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'clinic_staff' } } as any)
    render(<SettingsPage />)
    expect(screen.queryByRole('button', { name: /financeiro/i })).not.toBeInTheDocument()
  })

  it('vendedor NÃO vê a aba financeiro', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'vendedor' } } as any)
    render(<SettingsPage />)
    expect(screen.queryByRole('button', { name: /financeiro/i })).not.toBeInTheDocument()
  })

  it('clinic_admin vê a aba financeiro e navega nas sub-tabs', async () => {
    useAuthMock.mockReturnValue({ profile: { role: 'clinic_admin' } } as any)
    render(<SettingsPage />)

    const financeTab = screen.getByRole('button', { name: /financeiro/i })
    expect(financeTab).toBeInTheDocument()
    fireEvent.click(financeTab)

    // Default sub-tab: Taxas
    expect(await screen.findByRole('heading', { name: /^Taxas de Pagamento$/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Comissões$/i }))
    expect(await screen.findByRole('heading', { name: /^Comissões$/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Contas$/i }))
    expect(await screen.findByRole('heading', { name: /^Contas Fixas$/i })).toBeInTheDocument()
  })

  it('admin vê a aba financeiro', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'admin' } } as any)
    render(<SettingsPage />)
    expect(screen.getByRole('button', { name: /financeiro/i })).toBeInTheDocument()
  })
})
