import { timingSafeEqualString } from '@/lib/security/timingSafeEqual';

export interface InstallerGuardResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface InstallerGuardOptions {
  /**
   * true  → a rota autentica por token (run / run-stream / bootstrap): em produção
   *         exige INSTALLER_TOKEN configurado E conferido.
   * false → a rota não tem token (setup-instance, wizard humano de first-run): em
   *         produção exige apenas INSTALLER_ENABLED==='true'. Nunca exige token,
   *         porque o wizard não envia um.
   */
  requireToken: boolean;
  /** Token vindo do chamador (body.installerToken). Ignorado quando requireToken=false. */
  providedToken?: string;
}

const DISABLED: InstallerGuardResult = { ok: false, status: 403, error: 'Installer disabled' };

/**
 * Guarda fail-CLOSED do instalador (fix do achado X).
 *
 * ANTES: os handlers só bloqueavam com `INSTALLER_ENABLED==='false'` explícito
 * (unset = liberado) e pulavam a checagem de token quando `INSTALLER_TOKEN` não
 * estava setado. Em produção sem essas 2 vars, os endpoints de instalação — que
 * criam/deletam projeto Supabase, rodam migração e fazem bootstrap de admin —
 * ficavam abertos a qualquer chamador same-origin.
 *
 * AGORA: em produção o instalador só responde com opt-in EXPLÍCITO
 * (`INSTALLER_ENABLED==='true'`); rotas token-authed ainda exigem `INSTALLER_TOKEN`
 * configurado e conferido (timing-safe). Fora de produção o comportamento segue
 * permissivo para o setup local, mas um token configurado continua obrigatório.
 *
 * IMPLICAÇÃO OPERACIONAL: em produção, o wizard `/setup` (setup-instance) só funciona
 * com `INSTALLER_ENABLED=true` no ambiente. Documentar no runbook de provisionamento.
 */
export function assertInstallerAllowed(opts: InstallerGuardOptions): InstallerGuardResult {
  const enabled = process.env.INSTALLER_ENABLED;
  const expectedToken = process.env.INSTALLER_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';

  // Kill-switch explícito: vale em qualquer ambiente.
  if (enabled === 'false') return DISABLED;

  if (isProd) {
    // Fail-closed: em produção só responde com habilitação explícita.
    if (enabled !== 'true') return DISABLED;
    // Rotas token-authed exigem um token forte configurado em produção.
    if (opts.requireToken && !expectedToken) return DISABLED;
  }

  // Se a rota usa token e há um token configurado, ele é obrigatório e precisa bater.
  if (opts.requireToken && expectedToken) {
    if (!opts.providedToken || !timingSafeEqualString(opts.providedToken, expectedToken)) {
      return { ok: false, status: 403, error: 'Invalid installer token' };
    }
  }

  return { ok: true, status: 200 };
}
