export const APP_PERMISSIONS = [
  'whatsapp.access',
  'whatsapp.manage_connection',
  'conversations.access',
  'conversations.reply',
  'settings.users.manage',
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

export type PermissionDefinition = {
  key: AppPermission;
  label: string;
  description: string;
};

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: 'whatsapp.access',
    label: 'WhatsApp',
    description: 'Abrir a area do WhatsApp, gerar QR code, testar conexao e reconectar o numero.',
  },
  {
    key: 'whatsapp.manage_connection',
    label: 'Configurar WhatsApp',
    description: 'Editar API URL, instance, chave e configuracoes estruturais da conexao.',
  },
  {
    key: 'conversations.access',
    label: 'Conversations',
    description: 'Abrir o inbox operacional e acompanhar conversas da clinica.',
  },
  {
    key: 'conversations.reply',
    label: 'Responder conversas',
    description: 'Enviar mensagens, registrar saida e notas internas na conversa.',
  },
  {
    key: 'settings.users.manage',
    label: 'Gerenciar equipe',
    description: 'Convidar usuarios, remover equipe e ajustar permissoes individuais.',
  },
];

export type PermissionOverrideMap = Partial<Record<AppPermission, boolean>>;

export const ROLE_PERMISSION_DEFAULTS: Record<string, Record<AppPermission, boolean>> = {
  agency_admin: {
    'whatsapp.access': true,
    'whatsapp.manage_connection': true,
    'conversations.access': true,
    'conversations.reply': true,
    'settings.users.manage': true,
  },
  agency_staff: {
    'whatsapp.access': true,
    'whatsapp.manage_connection': false,
    'conversations.access': true,
    'conversations.reply': true,
    'settings.users.manage': false,
  },
  clinic_admin: {
    'whatsapp.access': true,
    'whatsapp.manage_connection': true,
    'conversations.access': true,
    'conversations.reply': true,
    'settings.users.manage': true,
  },
  clinic_staff: {
    'whatsapp.access': false,
    'whatsapp.manage_connection': false,
    'conversations.access': true,
    'conversations.reply': true,
    'settings.users.manage': false,
  },
  admin: {
    'whatsapp.access': true,
    'whatsapp.manage_connection': true,
    'conversations.access': true,
    'conversations.reply': true,
    'settings.users.manage': true,
  },
  vendedor: {
    'whatsapp.access': false,
    'whatsapp.manage_connection': false,
    'conversations.access': true,
    'conversations.reply': true,
    'settings.users.manage': false,
  },
};

export function getDefaultPermissionMap(role: string | null | undefined): Record<AppPermission, boolean> {
  const normalizedRole = role === 'admin'
    ? 'agency_admin'
    : role === 'vendedor'
      ? 'clinic_staff'
      : role;

  return {
    ...ROLE_PERMISSION_DEFAULTS.clinic_staff,
    ...(normalizedRole ? ROLE_PERMISSION_DEFAULTS[normalizedRole] ?? {} : {}),
  };
}

export function resolvePermissionMap(
  role: string | null | undefined,
  overrides?: PermissionOverrideMap | null
): Record<AppPermission, boolean> {
  const base = getDefaultPermissionMap(role);
  if (!overrides) return base;

  return APP_PERMISSIONS.reduce<Record<AppPermission, boolean>>((acc, permissionKey) => {
    acc[permissionKey] = overrides[permissionKey] ?? base[permissionKey];
    return acc;
  }, {} as Record<AppPermission, boolean>);
}

export function hasPermission(
  role: string | null | undefined,
  permission: AppPermission,
  overrides?: PermissionOverrideMap | null
) {
  return resolvePermissionMap(role, overrides)[permission];
}
