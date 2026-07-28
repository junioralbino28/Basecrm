import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const signInWithPassword = vi.fn()
const resetPasswordForEmail = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword, resetPasswordForEmail } }),
}))

import LoginPage from './page'

/**
 * "Esqueci minha senha" (Junior, 2026-07-27).
 *
 * Nasceu de um problema real: ele e o Adel perderam a senha do ambiente na
 * nuvem e foi preciso redefinir por fora, direto no banco. Numa clínica, a
 * secretária ficaria trancada do lado de fora.
 */
describe('LoginPage — recuperação de senha', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPasswordForEmail.mockResolvedValue({ error: null })
    signInWithPassword.mockResolvedValue({ error: null })
  })

  it('a entrada tem o caminho de quem esqueceu a senha', () => {
    render(<LoginPage />)
    expect(screen.getByRole('button', { name: /Esqueci minha senha/i })).toBeInTheDocument()
  })

  it('no modo recuperar, some o campo de senha e sobra só o email', () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /Esqueci minha senha/i }))

    expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Senha$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enviar link por email/i })).toBeInTheDocument()
  })

  it('envia o link apontando pra tela de criar senha nova', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /Esqueci minha senha/i }))
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'adel@exemplo.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Enviar link por email/i }))

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledTimes(1))
    expect(resetPasswordForEmail.mock.calls[0][0]).toBe('adel@exemplo.com')
    expect(String(resetPasswordForEmail.mock.calls[0][1].redirectTo)).toContain('/redefinir-senha')
    // Nunca tenta entrar quando o pedido é de recuperação.
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('confirma o envio SEM revelar se o email existe', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /Esqueci minha senha/i }))
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'ninguem@exemplo.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Enviar link por email/i }))

    // "SE existir uma conta" — dizer que não existe entregaria a quem tenta
    // invadir quais emails estão cadastrados.
    expect(await screen.findByText(/Se existir uma conta/i)).toBeInTheDocument()
  })
})
