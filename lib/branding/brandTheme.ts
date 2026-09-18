import { isAgencyRole } from '@/lib/auth/scope';

/**
 * Tema visual por organização. 'cenno' é o padrão (identidade da agência, CENNO CRM);
 * 'clinica' é o tema aprovado no mockup de 2026-06-10, preservado para quem já usa.
 * O CSS de cada tema mora em app/globals.css (`[data-brand="clinica"]`).
 */
export const BRAND_THEMES = ['cenno', 'clinica'] as const;
export type BrandTheme = (typeof BRAND_THEMES)[number];

export const BRAND_THEME_STORAGE_KEY = 'crm_brand_theme';

export function normalizeBrandTheme(value: unknown): BrandTheme {
  return value === 'clinica' ? 'clinica' : 'cenno';
}

/**
 * Qual tema pintar para o usuário logado.
 * - Agência vê sempre o próprio tema (CENNO), inclusive dentro do espaço de um cliente.
 * - Usuário de cliente vê o tema da própria organização.
 * - Enquanto a organização não carregou, devolve null (não troca nada: evita piscar).
 */
export function resolveBrandTheme(params: {
  role: unknown;
  tenantLoaded: boolean;
  brandingConfig?: { brandTheme?: unknown } | null;
}): BrandTheme | null {
  if (!params.role) return null;
  if (isAgencyRole(params.role)) return 'cenno';
  if (!params.tenantLoaded) return null;
  return normalizeBrandTheme(params.brandingConfig?.brandTheme);
}

/**
 * Script que roda no <head> antes da primeira pintura: repete o último tema usado neste
 * navegador para a tela não piscar do laranja para o verde enquanto o app carrega.
 */
export const BRAND_THEME_BOOT_SCRIPT = `try{if(localStorage.getItem('${BRAND_THEME_STORAGE_KEY}')==='clinica'){document.documentElement.setAttribute('data-brand','clinica')}}catch(e){}`;

export function applyBrandTheme(theme: BrandTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'clinica') root.setAttribute('data-brand', 'clinica');
  else root.removeAttribute('data-brand');
  try {
    localStorage.setItem(BRAND_THEME_STORAGE_KEY, theme);
  } catch {
    // navegador sem armazenamento: o tema ainda é aplicado, só não é lembrado
  }
}
