import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessagesSquare, MessageCircle, Workflow } from 'lucide-react';

// Ordem da sidebar decidida pelo Junior em 2026-07-21: Conversas logo abaixo de
// Contatos (das telas mais usadas por todos) e Automações/Conexões antes de
// Configurações — nunca empilhadas no fim, fora da dobra.

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({ default: () => <div data-testid="image" /> }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    loading: false,
    profile: { id: 'user-1', email: 'user@test.local', role: 'clinic_admin', organization_id: 'org-1' },
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: () => true,
}));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));
vi.mock('../context/CRMContext', () => ({
  useCRM: () => ({
    isGlobalAIOpen: false,
    setIsGlobalAIOpen: vi.fn(),
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
  }),
}));
vi.mock('@/context/TenantContext', () => ({
  useTenant: () => ({
    tenant: { organizationId: 'org-1', organizationName: 'Clínica' },
    loading: false,
  }),
}));
vi.mock('@/hooks/useResponsiveMode', () => ({ useResponsiveMode: () => ({ mode: 'desktop' }) }));
vi.mock('@/components/navigation', () => ({
  BottomNav: () => null,
  MoreMenuSheet: () => null,
}));
vi.mock('@/components/navigation/usePlatformTenantWorkspaceNav', () => ({
  usePlatformTenantWorkspaceNav: () => ({
    items: [
      { id: 'tenant_automations', label: 'Automações', href: '/platform/tenants/org-1/automations', icon: Workflow },
      { id: 'tenant_conversations', label: 'Conversas', href: '/platform/tenants/org-1/conversations', icon: MessagesSquare },
      { id: 'tenant_whatsapp', label: 'Conexoes', href: '/platform/tenants/org-1/whatsapp', icon: MessageCircle },
    ],
    tenantId: 'org-1',
  }),
}));
// Este teste é só sobre a ORDEM do menu — o contador/notificação de mensagens
// (que usa react-query) é neutralizado pra não exigir QueryClientProvider aqui.
vi.mock('@/components/notificacoes/NotificacoesDeConversa', () => ({
  NotificacoesDeConversa: () => null,
  useConversasNaoLidas: () => ({ data: undefined }),
  usePreferenciasNotificacao: () => ({ ativas: true, som: true }),
  salvarPreferencias: vi.fn(),
  pedirPermissaoDeNotificacao: vi.fn(async () => false),
  formatarHoraBR: () => '',
}));
vi.mock('@/components/navigation/useTenantScopedHref', () => ({
  useTenantScopedHrefBuilder: () => (path: string) => path,
}));
vi.mock('@/components/navigation/TenantClinicSwitcher', () => ({ TenantClinicSwitcher: () => null }));
vi.mock('@/lib/prefetch', () => ({ prefetchRoute: vi.fn() }));
vi.mock('@/lib/debug', () => ({
  isDebugMode: () => false,
  enableDebugMode: vi.fn(),
  disableDebugMode: vi.fn(),
}));
vi.mock('@/lib/a11y', () => ({ SkipLink: () => null }));
vi.mock('./ai/UIChat', () => ({ UIChat: () => null }));
vi.mock('./notifications/NotificationPopover', () => ({ NotificationPopover: () => null }));
vi.mock('@/components/PageLoader', () => ({ default: () => null }));
vi.mock('@/features/tarefas/components/TaskNudge', () => ({ TaskNudge: () => null }));

import Layout from './Layout';

function sidebarOrder() {
  const nav = screen.getByRole('navigation', { name: 'Navegação do sistema' });
  return Array.from(nav.querySelectorAll('a')).map((link) => link.textContent?.trim());
}

describe('ordem da sidebar da clínica', () => {
  it('põe Conversas logo depois de Contatos', () => {
    render(<Layout><div>Conteúdo</div></Layout>);

    const order = sidebarOrder();
    expect(order.indexOf('Conversas')).toBe(order.indexOf('Contatos') + 1);
  });

  it('põe Automações antes de Configurações, não no fim da lista', () => {
    render(<Layout><div>Conteúdo</div></Layout>);

    const order = sidebarOrder();
    expect(order.indexOf('Automações')).toBeGreaterThan(-1);
    expect(order.indexOf('Automações')).toBeLessThan(order.indexOf('Configurações'));
    expect(order[order.length - 1]).toBe('Configurações');
  });
});
