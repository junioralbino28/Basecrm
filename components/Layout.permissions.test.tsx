import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let role = 'clinic_admin';
let permissions: Record<string, boolean> = {};

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
    profile: { id: 'user-1', email: 'user@test.local', role, organization_id: 'org-1' },
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/auth/useHasPermission', () => ({
  useHasPermission: (permission: string) => permissions[permission] ?? false,
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
  usePlatformTenantWorkspaceNav: () => ({ items: [] }),
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

beforeEach(() => {
  role = 'clinic_admin';
  permissions = {
    'reports.finance': true,
    'reports.professionals': true,
  };
});

describe('Layout permissions', () => {
  it('esconde Financeiro e Profissionais quando as permissões estão negadas', () => {
    permissions = {
      'reports.finance': false,
      'reports.professionals': false,
    };

    render(<Layout><div>Conteúdo</div></Layout>);

    expect(screen.queryByRole('link', { name: 'Financeiro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Profissionais' })).not.toBeInTheDocument();
  });

  it('exibe Financeiro e Profissionais quando as permissões estão concedidas', () => {
    role = 'clinic_staff';

    render(<Layout><div>Conteúdo</div></Layout>);

    expect(screen.getByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profissionais' })).toBeInTheDocument();
  });
});
