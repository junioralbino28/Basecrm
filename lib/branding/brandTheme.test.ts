import { describe, expect, it } from 'vitest';
import { BRAND_THEME_BOOT_SCRIPT, normalizeBrandTheme, resolveBrandTheme } from './brandTheme';

describe('normalizeBrandTheme', () => {
  it('só aceita "clinica"; qualquer outra coisa vira o padrão CENNO', () => {
    expect(normalizeBrandTheme('clinica')).toBe('clinica');
    expect(normalizeBrandTheme('cenno')).toBe('cenno');
    expect(normalizeBrandTheme(undefined)).toBe('cenno');
    expect(normalizeBrandTheme('verde')).toBe('cenno');
  });
});

describe('resolveBrandTheme', () => {
  it('agência vê sempre CENNO, mesmo com a organização ativa sendo uma clínica', () => {
    expect(resolveBrandTheme({ role: 'agency_admin', tenantLoaded: true, brandingConfig: { brandTheme: 'clinica' } })).toBe('cenno');
    expect(resolveBrandTheme({ role: 'agency_staff', tenantLoaded: false })).toBe('cenno');
    expect(resolveBrandTheme({ role: 'admin', tenantLoaded: true, brandingConfig: { brandTheme: 'clinica' } })).toBe('cenno');
  });

  it('usuário da clínica vê o tema da própria organização', () => {
    expect(resolveBrandTheme({ role: 'clinic_admin', tenantLoaded: true, brandingConfig: { brandTheme: 'clinica' } })).toBe('clinica');
    expect(resolveBrandTheme({ role: 'clinic_staff', tenantLoaded: true, brandingConfig: { brandTheme: 'clinica' } })).toBe('clinica');
  });

  it('cliente sem tema declarado recebe o padrão CENNO', () => {
    expect(resolveBrandTheme({ role: 'clinic_admin', tenantLoaded: true, brandingConfig: {} })).toBe('cenno');
    expect(resolveBrandTheme({ role: 'clinic_admin', tenantLoaded: true, brandingConfig: null })).toBe('cenno');
  });

  it('não decide nada antes de saber o papel ou de a organização carregar (evita piscar)', () => {
    expect(resolveBrandTheme({ role: null, tenantLoaded: true, brandingConfig: { brandTheme: 'clinica' } })).toBeNull();
    expect(resolveBrandTheme({ role: 'clinic_admin', tenantLoaded: false })).toBeNull();
  });
});

describe('BRAND_THEME_BOOT_SCRIPT', () => {
  it('é uma linha só, sem quebra, protegida por try/catch', () => {
    expect(BRAND_THEME_BOOT_SCRIPT).not.toMatch(/\n/);
    expect(BRAND_THEME_BOOT_SCRIPT.startsWith('try{')).toBe(true);
    expect(BRAND_THEME_BOOT_SCRIPT).toContain("setAttribute('data-brand','clinica')");
  });
});
