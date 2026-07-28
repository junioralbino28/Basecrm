import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Função pública `updateSession` do projeto.
 *
 * @param {NextRequest} request - Objeto da requisição.
 * @returns {Promise<NextResponse<unknown>>} Retorna um valor do tipo `Promise<NextResponse<unknown>>`.
 */
export async function updateSession(request: NextRequest) {
    // NOTE: Apesar do nome do arquivo, esta função é consumida pelo `proxy.ts` (Next 16+).
    // O Next renomeou a convenção de `middleware.ts` -> `proxy.ts`.
    // Doc: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
    //
    // Importante: o Proxy NÃO deve interferir em `/api/*`.
    // Route Handlers devem responder com 401/403 quando necessário.
    // Se redirecionarmos `/api/*` para `/login`, quebramos `fetch`/SDKs.
    if (request.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.next({ request })
    }

    // Check if Supabase is properly configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    // Prefer new publishable key format, fallback to legacy anon key
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Skip auth if not configured or using placeholder values
    const isConfigured = supabaseUrl &&
        supabaseAnonKey &&
        !supabaseUrl.includes('your_') &&
        supabaseUrl.startsWith('http')

    if (!isConfigured) {
        console.warn('[proxy] Supabase not configured - skipping auth check')
        return NextResponse.next({ request })
    }

    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Refreshing the auth token
    const {
        data: { user },
    } = await supabase.auth.getUser()

    // ---------------------------------------------------------------------
    // Setup guard: se a instância não foi inicializada, forçar /setup
    // ---------------------------------------------------------------------
    // Observação: is_instance_initialized() está com GRANT para anon/authenticated.
    // Se der erro, falhamos "aberto" (não bloqueia navegação) para evitar lockout.
    const pathname = request.nextUrl.pathname
    const isSetupRoute = pathname === '/setup' || pathname.startsWith('/setup/')
    const isInstallRoute = pathname === '/install' || pathname.startsWith('/install/')

    try {
        const { data: initData, error: initError } = await supabase.rpc('is_instance_initialized')
        if (!initError && initData === false && !isSetupRoute && !isInstallRoute) {
            const url = request.nextUrl.clone()
            url.pathname = '/setup'
            return NextResponse.redirect(url)
        }
    } catch {
        // ignore
    }

    // Protected routes - redirect to login if not authenticated
    //
    // `/redefinir-senha` PRECISA ser pública: quem chega ali veio do link do
    // email e AINDA NÃO tem sessão. Pior, o código de recuperação viaja na
    // ÂNCORA da URL (#access_token=…), que o servidor nunca enxerga — então
    // mandar pro /login não só barra a pessoa como DESTRÓI o código no caminho.
    // (Junior, 2026-07-27: clicou no link do email e caiu no login.)
    const isRecoveryRoute = pathname.startsWith('/redefinir-senha')
    const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/auth')
    const isPublicRoute = pathname === '/' || pathname.startsWith('/join')
        || isSetupRoute || isInstallRoute || isRecoveryRoute

    if (!user && !isAuthRoute && !isPublicRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Redirect authenticated users away from login.
    // A recuperação fica de fora: a sessão criada pelo link é justamente o que
    // permite trocar a senha — expulsar pro dashboard tiraria a pessoa da tela
    // antes de ela escolher a senha nova.
    if (user && isAuthRoute && !isRecoveryRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    return supabaseResponse
}
