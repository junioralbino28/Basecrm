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
  MessageCircle,
  MessagesSquare,
} from 'lucide-react';

export type PrimaryNavId = 'inbox' | 'boards' | 'contacts' | 'activities' | 'more';

export interface PrimaryNavItem {
  id: PrimaryNavId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

const PRIMARY_NAV_BASE: PrimaryNavItem[] = [
  { id: 'inbox', label: 'Inbox', href: '/inbox', icon: Inbox },
  { id: 'boards', label: 'Boards', href: '/boards', icon: KanbanSquare },
  { id: 'contacts', label: 'Contatos', href: '/contacts', icon: Users },
  { id: 'activities', label: 'Atividades', href: '/activities', icon: CheckSquare },
  { id: 'more', label: 'Mais', href: '#more', icon: MoreHorizontal },
];

export type SecondaryNavId =
  | 'dashboard'
  | 'reports'
  | 'settings'
  | 'profile'
  | 'platform'
  | 'platform_tenants'
  | 'platform_new_tenant'
  | 'tenant_whatsapp_connect'
  | 'tenant_whatsapp'
  | 'tenant_conversations';

export interface SecondaryNavItem {
  id: SecondaryNavId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

const SECONDARY_NAV: SecondaryNavItem[] = [
  { id: 'dashboard', label: 'Visao Geral', href: '/dashboard', icon: LayoutDashboard },
  { id: 'reports', label: 'Relatorios', href: '/reports', icon: BarChart3 },
  { id: 'settings', label: 'Configuracoes', href: '/settings', icon: Settings },
  { id: 'profile', label: 'Perfil', href: '/profile', icon: User },
];

export function getPrimaryNav(options?: {
  tenantId?: string | null;
  getHref?: (href: string) => string;
}): PrimaryNavItem[] {
  const getHref = options?.getHref ?? ((href: string) => href);

  return PRIMARY_NAV_BASE.map((item) => ({
    ...item,
    href: item.id === 'more' ? item.href : getHref(item.href),
  }));
}

export function getSecondaryNav(options: {
  isAdmin: boolean;
  getHref?: (href: string) => string;
}): SecondaryNavItem[] {
  const { isAdmin, getHref = (href: string) => href } = options;
  const baseItems = SECONDARY_NAV.map((item) => ({
    ...item,
    href: getHref(item.href),
  }));

  if (!isAdmin) return baseItems;

  return [
    { id: 'platform', label: 'Platform Admin', href: '/platform', icon: Building2 },
    { id: 'platform_tenants', label: 'Clinicas', href: '/platform/tenants', icon: Building2 },
    { id: 'platform_new_tenant', label: 'Nova Clinica', href: '/platform/tenants/new', icon: PlusSquare },
    ...baseItems,
  ];
}

export function getTenantWorkspaceNav(options: {
  tenantId?: string | null;
  hasConnectedWhatsapp?: boolean;
  canAccessWhatsapp?: boolean;
  canAccessConversations?: boolean;
}): SecondaryNavItem[] {
  const {
    tenantId,
    hasConnectedWhatsapp = false,
    canAccessWhatsapp = false,
    canAccessConversations = false,
  } = options;
  if (!tenantId) return [];
  if (!canAccessWhatsapp && !canAccessConversations) return [];

  return [
    ...(canAccessConversations
      ? [{ id: 'tenant_conversations', label: 'Conversations', href: `/platform/tenants/${tenantId}/conversations`, icon: MessagesSquare } satisfies SecondaryNavItem]
      : []),
    ...(canAccessWhatsapp
      ? [{
          id: hasConnectedWhatsapp ? 'tenant_whatsapp' : 'tenant_whatsapp_connect',
          label: hasConnectedWhatsapp ? 'WhatsApp' : 'Conectar WhatsApp',
          href: `/platform/tenants/${tenantId}/whatsapp`,
          icon: MessageCircle,
        } satisfies SecondaryNavItem]
      : []),
  ];
}
