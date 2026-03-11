export const APP_USER_ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
] as const;

export type AppUserRole = (typeof APP_USER_ROLES)[number];

export type RoleOption = {
  value: AppUserRole;
  label: string;
  description: string;
};

export function normalizeAppUserRole(value: unknown): AppUserRole {
  switch (value) {
    case 'agency_admin':
    case 'agency_staff':
    case 'clinic_admin':
    case 'clinic_staff':
    case 'admin':
    case 'vendedor':
      return value;
    default:
      return 'vendedor';
  }
}

export function isAgencyAdminRole(role: unknown): boolean {
  const normalized = normalizeAppUserRole(role);
  return normalized === 'agency_admin' || normalized === 'admin';
}

export function isAgencyStaffRole(role: unknown): boolean {
  return normalizeAppUserRole(role) === 'agency_staff';
}

export function isAgencyRole(role: unknown): boolean {
  return isAgencyAdminRole(role) || isAgencyStaffRole(role);
}

export function isClinicAdminRole(role: unknown): boolean {
  return normalizeAppUserRole(role) === 'clinic_admin';
}

export function isClinicStaffRole(role: unknown): boolean {
  const normalized = normalizeAppUserRole(role);
  return normalized === 'clinic_staff' || normalized === 'vendedor';
}

export function isClinicRole(role: unknown): boolean {
  return isClinicAdminRole(role) || isClinicStaffRole(role);
}

export function canManageClinicSettings(role: unknown): boolean {
  return isAgencyAdminRole(role) || isClinicAdminRole(role);
}

export function canManageGlobalUsers(role: unknown): boolean {
  return isAgencyAdminRole(role);
}

export function getRoleLabel(role: unknown): string {
  switch (normalizeAppUserRole(role)) {
    case 'agency_admin':
      return 'Admin da Agencia';
    case 'agency_staff':
      return 'Equipe da Agencia';
    case 'clinic_admin':
      return 'Admin da Clinica';
    case 'clinic_staff':
      return 'Equipe da Clinica';
    case 'admin':
      return 'Admin';
    case 'vendedor':
    default:
      return 'Vendedor';
  }
}

export function getAssignableRoles(params: {
  actorRole: unknown;
  managingOwnOrganization: boolean;
}): AppUserRole[] {
  const actorRole = normalizeAppUserRole(params.actorRole);

  if (isAgencyAdminRole(actorRole)) {
    return params.managingOwnOrganization
      ? ['agency_admin', 'agency_staff']
      : ['clinic_admin', 'clinic_staff'];
  }

  if (isClinicAdminRole(actorRole)) {
    return ['clinic_admin', 'clinic_staff'];
  }

  return [];
}

export function getRoleOptions(params: {
  actorRole: unknown;
  managingOwnOrganization: boolean;
}): RoleOption[] {
  return getAssignableRoles(params).map((role) => ({
    value: role,
    label: getRoleLabel(role),
    description:
      role === 'agency_admin'
        ? 'Controle total da agencia, clinicas e permissoes.'
        : role === 'agency_staff'
          ? 'Opera a agencia com acessos customizaveis por permissao.'
          : role === 'clinic_admin'
            ? 'Administra a operacao e a equipe da clinica.'
            : role === 'clinic_staff'
              ? 'Atua no operacional da clinica com acessos limitados.'
              : role === 'admin'
                ? 'Perfil legado de administrador.'
                : 'Perfil legado operacional.',
  }));
}
