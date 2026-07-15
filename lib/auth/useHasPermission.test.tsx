import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppPermission } from './permissions';

let permissions: Partial<Record<AppPermission, boolean>> | null | undefined;

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ permissions }),
}));

import { useHasPermission } from './useHasPermission';

beforeEach(() => {
  permissions = null;
});

describe('useHasPermission', () => {
  it('retorna false para uma permissão negada', () => {
    permissions = { 'reports.finance': false };

    const { result } = renderHook(() => useHasPermission('reports.finance'));

    expect(result.current).toBe(false);
  });

  it('retorna true para uma permissão concedida', () => {
    permissions = { 'contacts.view': true };

    const { result } = renderHook(() => useHasPermission('contacts.view'));

    expect(result.current).toBe(true);
  });

  it('retorna undefined enquanto as permissões carregam', () => {
    const { result } = renderHook(() => useHasPermission('reports.finance'));

    expect(result.current).toBeUndefined();
  });

  it('trata contexto legado sem o campo permissions como carregando', () => {
    permissions = undefined;

    const { result } = renderHook(() => useHasPermission('reports.finance'));

    expect(result.current).toBeUndefined();
  });
});
