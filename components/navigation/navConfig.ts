import type { ComponentType } from 'react';
import {
  Inbox,
  KanbanSquare,
  Users,
  CheckSquare,
  MoreHorizontal,
  LayoutDashboard,
  BarChart3,
  Settings,
  User,
  Building2,
  PlusSquare,
} from 'lucide-react';

export type PrimaryNavId = 'inbox' | 'boards' | 'contacts' | 'activities' | 'more';

export interface PrimaryNavItem {
  id: PrimaryNavId;
  label: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: 'inbox', label: 'Inbox', href: '/inbox', icon: Inbox },
  { id: 'boards', label: 'Boards', href: '/boards', icon: KanbanSquare },
  { id: 'contacts', label: 'Contatos', href: '/contacts', icon: Users },
  { id: 'activities', label: 'Atividades', href: '/activities', icon: CheckSquare },
  { id: 'more', label: 'Mais', icon: MoreHorizontal },
];

export type SecondaryNavId =
  | 'dashboard'
  | 'reports'
  | 'settings'
  | 'profile'
  | 'platform'
  | 'platform_tenants'
  | 'platform_new_tenant';

export interface SecondaryNavItem {
  id: SecondaryNavId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

export const SECONDARY_NAV: SecondaryNavItem[] = [
  { id: 'dashboard', label: 'Visao Geral', href: '/dashboard', icon: LayoutDashboard },
  { id: 'reports', label: 'Relatorios', href: '/reports', icon: BarChart3 },
  { id: 'settings', label: 'Configuracoes', href: '/settings', icon: Settings },
  { id: 'profile', label: 'Perfil', href: '/profile', icon: User },
];

export function getSecondaryNav(isAdmin: boolean): SecondaryNavItem[] {
  if (!isAdmin) return SECONDARY_NAV;

  return [
    { id: 'platform', label: 'Platform Admin', href: '/platform', icon: Building2 },
    { id: 'platform_tenants', label: 'Clinicas', href: '/platform/tenants', icon: Building2 },
    { id: 'platform_new_tenant', label: 'Nova Clinica', href: '/platform/tenants/new', icon: PlusSquare },
    ...SECONDARY_NAV,
  ];
}
