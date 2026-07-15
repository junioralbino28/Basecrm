'use client';

import { useAuth } from '@/context/AuthContext';
import type { AppPermission } from '@/lib/auth/permissions';

export function useHasPermission(permission: AppPermission): boolean | undefined {
  const { permissions } = useAuth();

  if (permissions === null) return undefined;
  return permissions[permission] ?? false;
}
