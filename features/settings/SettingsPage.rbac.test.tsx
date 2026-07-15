import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPermission } from '@/lib/auth/permissions'

const testState = vi.hoisted(() => ({
  pathname: '/settings',
  role: 'admin',
  authLoading: false,
  permissions: {} as Partial<Record<AppPermission, boolean | undefined>>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => testState.pathname,
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { role: testState.role },
    loading: testState.authLoading,
  }),
}))

vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: (permission: AppPermission) => testState.permissions[permission],
}))

vi.mock('@/components/PageLoader', () => ({
  default: () => <div>Carregando permissões</div>,
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

vi.mock('./components/ProductsCatalogManager', () => ({
  ProductsCatalogManager: () => <h3>Conteúdo Produtos</h3>,
}))

vi.mock('./components/ProfessionalsManager', () => ({
  ProfessionalsManager: () => <h3>Conteúdo Profissionais</h3>,
}))

vi.mock('./components/CardFeesManager', () => ({
  CardFeesManager: () => <h3>Conteúdo Financeiro</h3>,
}))

vi.mock('./components/CommissionsManager', () => ({
  CommissionsManager: () => <div>Comissões</div>,
}))

vi.mock('./components/FixedCostsManager', () => ({
  FixedCostsManager: () => <div>Custos fixos</div>,
}))

vi.mock('./components/PlanilhasSection', () => ({
  PlanilhasSection: () => <div>Planilhas</div>,
}))

vi.mock('./components/DataStorageSettings', () => ({
  DataStorageSettings: () => <h3>Conteúdo Dados</h3>,
}))

vi.mock('./components/ApiKeysSection', () => ({
  ApiKeysSection: () => <h3>Conteúdo Integrações</h3>,
}))

vi.mock('./components/WebhooksSection', () => ({
  WebhooksSection: () => <div>Webhooks</div>,
}))

vi.mock('./components/McpSection', () => ({
  McpSection: () => <div>MCP</div>,
}))

vi.mock('./AICenterSettings', () => ({
  AICenterSettings: () => <h3>Conteúdo IA</h3>,
}))

vi.mock('./UsersPage', () => ({
  UsersPage: () => <h3>Conteúdo Equipe</h3>,
}))

import SettingsPage from './SettingsPage'

const allowedPermissions: AppPermission[] = [
  'settings.general',
  'settings.products',
  'settings.professionals',
  'settings.finance',
  'settings.integrations',
  'ai.configure',
  'settings.users.manage',
]

describe('SettingsPage permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.pathname = '/settings'
    testState.role = 'admin'
    testState.authLoading = false
    testState.permissions = Object.fromEntries(
      allowedPermissions.map((permission) => [permission, true]),
    ) as Partial<Record<AppPermission, boolean | undefined>>
  })

  it('oculta as abas cujas permissões estão negadas', () => {
    testState.permissions = {
      ...testState.permissions,
      'settings.general': false,
      'settings.products': false,
      'settings.professionals': false,
      'settings.integrations': false,
      'ai.configure': false,
      'settings.users.manage': false,
    }

    render(<SettingsPage />)

    expect(screen.queryByRole('button', { name: /^Geral$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Produtos\/Serviços/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Profissionais$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Integrações$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Central de I\.A/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Equipe$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Financeiro$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Dados$/i })).toBeInTheDocument()
  })

  it('permite que clinic_staff com override abra Profissionais', async () => {
    testState.role = 'clinic_staff'

    render(<SettingsPage />)

    const professionalsTab = screen.getByRole('button', { name: /^Profissionais$/i })
    fireEvent.click(professionalsTab)

    expect(await screen.findByRole('heading', { name: 'Conteúdo Profissionais' })).toBeInTheDocument()
  })

  it.each(['clinic_admin', 'clinic_staff'])(
    'oculta a aba Dados para o role de clínica %s',
    (role) => {
      testState.role = role

      render(<SettingsPage />)

      expect(screen.queryByRole('button', { name: /^Dados$/i })).not.toBeInTheDocument()
    },
  )

  it('bloqueia a URL direta de Dados para usuário de clínica', async () => {
    testState.pathname = '/settings/data'
    testState.role = 'clinic_admin'

    render(<SettingsPage />)

    expect(await screen.findByRole('status')).toHaveTextContent('Acesso restrito')
    expect(screen.queryByRole('heading', { name: 'Conteúdo Dados' })).not.toBeInTheDocument()
  })

  it.each(['agency_admin', 'agency_staff', 'admin'])(
    'exibe e abre a aba Dados para o role de agência %s',
    async (role) => {
      testState.role = role

      render(<SettingsPage />)

      fireEvent.click(screen.getByRole('button', { name: /^Dados$/i }))
      expect(await screen.findByRole('heading', { name: 'Conteúdo Dados' })).toBeInTheDocument()
    },
  )

  it('não monta Dados enquanto o perfil ainda está carregando', async () => {
    testState.pathname = '/settings/data'
    testState.role = 'agency_admin'
    testState.authLoading = true

    render(<SettingsPage />)

    expect(await screen.findByText('Carregando permissões')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Conteúdo Dados' })).not.toBeInTheDocument()
  })

  it.each([
    ['/settings', 'settings.general', 'Página Inicial'],
    ['/settings/products', 'settings.products', 'Conteúdo Produtos'],
    ['/settings/profissionais', 'settings.professionals', 'Conteúdo Profissionais'],
    ['/settings/financeiro', 'settings.finance', 'Conteúdo Financeiro'],
    ['/settings/integracoes', 'settings.integrations', 'Conteúdo Integrações'],
    ['/settings/ai', 'ai.configure', 'Conteúdo IA'],
    ['/settings/users', 'settings.users.manage', 'Conteúdo Equipe'],
  ] as const)(
    'fecha o bypass pela URL %s quando %s está negada',
    async (pathname, permission, protectedContent) => {
      testState.pathname = pathname
      testState.permissions = { ...testState.permissions, [permission]: false }

      render(<SettingsPage />)

      expect(await screen.findByRole('status')).toHaveTextContent('Acesso restrito')
      expect(screen.queryByText(protectedContent)).not.toBeInTheDocument()
    },
  )

  it('aguarda a resolução da permissão antes de renderizar uma rota direta', async () => {
    testState.pathname = '/settings/products'
    testState.permissions = { ...testState.permissions, 'settings.products': undefined }

    render(<SettingsPage />)

    expect(await screen.findByText('Carregando permissões')).toBeInTheDocument()
    expect(screen.queryByText('Conteúdo Produtos')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
