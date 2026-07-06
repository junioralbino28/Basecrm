import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertInstallerAllowed } from './guard';

// Regressão do achado X (installer fail-open). Antes: os handlers só bloqueavam com
// INSTALLER_ENABLED==='false' EXPLÍCITO (unset = liberado) e pulavam o token quando
// INSTALLER_TOKEN não estava setado. Em produção sem as 2 vars, o instalador (cria/
// deleta projeto Supabase, roda migração, faz bootstrap de admin) ficava ABERTO.
// Agora é fail-CLOSED em produção.

afterEach(() => vi.unstubAllEnvs());

describe('assertInstallerAllowed — fail-closed (achado X)', () => {
  describe('rota token-authed (run / run-stream / bootstrap)', () => {
    it('PROD sem nada configurado → 403 (antes provisionava)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('INSTALLER_ENABLED', '');
      vi.stubEnv('INSTALLER_TOKEN', '');
      const r = assertInstallerAllowed({ requireToken: true, providedToken: undefined });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    });

    it('PROD habilitado mas SEM token configurado → 403 (token é obrigatório em prod)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('INSTALLER_ENABLED', 'true');
      vi.stubEnv('INSTALLER_TOKEN', '');
      const r = assertInstallerAllowed({ requireToken: true, providedToken: 'qualquer' });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    });

    it('PROD habilitado + token configurado + token errado → 403', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('INSTALLER_ENABLED', 'true');
      vi.stubEnv('INSTALLER_TOKEN', 'segredo-forte');
      const r = assertInstallerAllowed({ requireToken: true, providedToken: 'errado' });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
      expect(r.error).toBe('Invalid installer token');
    });

    it('PROD habilitado + token configurado + token certo → ok', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('INSTALLER_ENABLED', 'true');
      vi.stubEnv('INSTALLER_TOKEN', 'segredo-forte');
      const r = assertInstallerAllowed({ requireToken: true, providedToken: 'segredo-forte' });
      expect(r.ok).toBe(true);
    });

    it('DEV sem token configurado → permissivo (setup local)', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('INSTALLER_ENABLED', '');
      vi.stubEnv('INSTALLER_TOKEN', '');
      const r = assertInstallerAllowed({ requireToken: true, providedToken: undefined });
      expect(r.ok).toBe(true);
    });

    it('DEV com token configurado ainda exige o token certo', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('INSTALLER_ENABLED', '');
      vi.stubEnv('INSTALLER_TOKEN', 'segredo-forte');
      expect(assertInstallerAllowed({ requireToken: true, providedToken: 'errado' }).ok).toBe(false);
      expect(assertInstallerAllowed({ requireToken: true, providedToken: 'segredo-forte' }).ok).toBe(true);
    });
  });

  describe('rota sem token (setup-instance / wizard humano)', () => {
    it('PROD não habilitado → 403 (fecha a corrida pelo primeiro admin)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('INSTALLER_ENABLED', '');
      vi.stubEnv('INSTALLER_TOKEN', '');
      const r = assertInstallerAllowed({ requireToken: false });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    });

    it('PROD habilitado → ok sem exigir token (wizard não envia)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('INSTALLER_ENABLED', 'true');
      vi.stubEnv('INSTALLER_TOKEN', '');
      const r = assertInstallerAllowed({ requireToken: false });
      expect(r.ok).toBe(true);
    });

    it('DEV → ok (onboarding local, ainda gated por is_instance_initialized)', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('INSTALLER_ENABLED', '');
      const r = assertInstallerAllowed({ requireToken: false });
      expect(r.ok).toBe(true);
    });
  });

  it('kill-switch INSTALLER_ENABLED=false bloqueia em qualquer ambiente', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INSTALLER_ENABLED', 'false');
    expect(assertInstallerAllowed({ requireToken: false }).ok).toBe(false);
    expect(assertInstallerAllowed({ requireToken: true, providedToken: 'x' }).ok).toBe(false);
  });
});
