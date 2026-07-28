'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/utils/errorUtils'
import { Loader2, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react'

/**
 * Criar senha nova a partir do link recebido por email.
 *
 * Junior, 2026-07-27: o CRM não tinha "esqueci minha senha" — quando ele e o
 * Adel perderam a senha do ambiente na nuvem, foi preciso redefinir por fora,
 * pelo banco. Numa clínica de verdade a secretária ficaria trancada do lado de
 * fora esperando alguém com acesso técnico.
 *
 * COMO FUNCIONA: o link do email traz um token na âncora da URL; o cliente do
 * Supabase troca isso por uma sessão temporária de recuperação. Com ela vale
 * `updateUser({ password })` — e só isso, nada mais. Por isso a tela não pede a
 * senha antiga: quem chegou aqui provou que tem o email.
 */
export default function RedefinirSenhaPage() {
    const [senha, setSenha] = useState('')
    const [confirmacao, setConfirmacao] = useState('')
    const [mostrar, setMostrar] = useState(false)
    const [carregando, setCarregando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)
    const [pronto, setPronto] = useState(false)
    const [linkValido, setLinkValido] = useState<boolean | null>(null)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        if (!supabase) { setLinkValido(false); return }
        // A sessão de recuperação chega pela URL e o cliente a resolve sozinho;
        // aqui só perguntamos se ela existe, pra não mostrar um formulário que
        // vai falhar no fim.
        let vivo = true
        const conferir = async () => {
            const { data } = await supabase.auth.getSession()
            if (vivo) setLinkValido(Boolean(data.session))
        }
        void conferir()
        const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
            if (evento === 'PASSWORD_RECOVERY' || evento === 'SIGNED_IN') setLinkValido(true)
        })
        return () => { vivo = false; sub.subscription.unsubscribe() }
    }, [supabase])

    const salvar = async (e: React.FormEvent) => {
        e.preventDefault()
        setErro(null)

        if (senha.length < 8) {
            setErro('A senha precisa ter pelo menos 8 caracteres.')
            return
        }
        if (senha !== confirmacao) {
            setErro('As duas senhas não são iguais. Confira e tente de novo.')
            return
        }

        setCarregando(true)
        try {
            if (!supabase) throw new Error('Supabase não configurado.')
            const { error } = await supabase.auth.updateUser({ password: senha })
            if (error) throw error
            setPronto(true)
            setTimeout(() => router.push('/dashboard'), 1800)
        } catch (err) {
            setErro(getErrorMessage(err))
        } finally {
            setCarregando(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg px-4">
            <div className="max-w-md w-full">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight mb-2">
                        Criar uma senha nova
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                        Escolha a senha que você vai usar para entrar daqui pra frente.
                    </p>
                </div>

                <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-8">
                    {pronto ? (
                        <div className="text-center py-4" role="status">
                            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                            <p className="text-slate-900 dark:text-white font-semibold">Senha alterada.</p>
                            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                                Já estamos te levando pra dentro do sistema…
                            </p>
                        </div>
                    ) : linkValido === false ? (
                        <div className="text-center py-4">
                            <p className="text-slate-900 dark:text-white font-semibold mb-1">
                                Esse link não vale mais
                            </p>
                            <p className="text-slate-500 dark:text-slate-400 text-sm mb-5">
                                Links de recuperação expiram e só podem ser usados uma vez.
                                Peça um novo na tela de entrada.
                            </p>
                            <button
                                type="button"
                                onClick={() => router.push('/login')}
                                className="text-sm font-bold text-brand-600 hover:text-brand-500"
                            >
                                Voltar para a entrada
                            </button>
                        </div>
                    ) : (
                        <form className="space-y-5" onSubmit={salvar}>
                            <div>
                                <label htmlFor="senha-nova" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                    Senha nova
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Lock className="h-5 w-5 text-slate-400" />
                                    </div>
                                    <input
                                        id="senha-nova"
                                        type={mostrar ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        required
                                        value={senha}
                                        onChange={(e) => setSenha(e.target.value)}
                                        placeholder="pelo menos 8 caracteres"
                                        className="block w-full pl-10 pr-10 py-2.5 border border-slate-300 dark:border-line rounded-xl bg-slate-50 dark:bg-card/50 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50 sm:text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setMostrar((v) => !v)}
                                        aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                        {mostrar ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="senha-confirmacao" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                    Repita a senha
                                </label>
                                <input
                                    id="senha-confirmacao"
                                    type={mostrar ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    required
                                    value={confirmacao}
                                    onChange={(e) => setConfirmacao(e.target.value)}
                                    className="block w-full px-3 py-2.5 border border-slate-300 dark:border-line rounded-xl bg-slate-50 dark:bg-card/50 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50 sm:text-sm"
                                />
                            </div>

                            {erro && (
                                <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm text-center">
                                    {erro}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={carregando}
                                className="w-full flex justify-center items-center py-3 px-4 rounded-xl text-sm font-bold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50 transition-all active:scale-[0.98]"
                            >
                                {carregando ? <Loader2 className="animate-spin h-5 w-5" /> : 'Salvar senha nova'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    )
}
