import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  permission: false as boolean | undefined,
  role: 'admin',
}))

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/users',
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'current-user',
      email: 'current@example.com',
      role: testState.role,
    },
  }),
}))

vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({ tenant: { organizationId: 'clinic-1' } }),
}))

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: () => testState.permission,
}))

vi.mock('@/components/PageLoader', () => ({
  default: () => <div>Carregando permissões</div>,
}))

vi.mock('@/components/ConfirmModal', () => ({
  default: () => null,
}))

import { UsersPage } from './UsersPage'

describe('UsersPage permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.permission = false
    testState.role = 'admin'
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ users: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('nega acesso sem settings.users.manage mesmo para um admin', async () => {
    render(<UsersPage />)

    expect(await screen.findByRole('status')).toHaveTextContent('Acesso restrito')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('não busca nem monta a equipe enquanto a permissão está carregando', async () => {
    testState.permission = undefined

    render(<UsersPage />)

    expect(await screen.findByText('Carregando permissões')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /Equipe da Clinica/i })).not.toBeInTheDocument()
  })

  it('permite acesso a clinic_staff com override positivo', async () => {
    testState.permission = true
    testState.role = 'clinic_staff'

    render(<UsersPage />)

    expect(await screen.findByRole('heading', { name: /Equipe da Clinica/i })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/users?tenantId=clinic-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})
