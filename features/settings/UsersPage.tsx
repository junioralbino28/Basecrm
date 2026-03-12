import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import ConfirmModal from '@/components/ConfirmModal';
import { Loader2, UserPlus, Crown, Briefcase, KeyRound, Mail, Check, X, Sparkles, Clock, RefreshCw, Trash2, Link, Copy, CheckCircle2 } from 'lucide-react';
import { PERMISSION_DEFINITIONS, type AppPermission } from '@/lib/auth/permissions';
import { getRoleLabel, getRoleOptions, isAgencyAdminRole, isClinicAdminRole, normalizeAppUserRole, type AppUserRole } from '@/lib/auth/scope';

interface Profile {
    id: string;
    email: string;
    role: string;
    organization_id: string;
    created_at: string;
    status: 'active' | 'pending';
    invited_at?: string;
    confirmed_at?: string;
    last_sign_in_at?: string;
    permission_overrides?: Partial<Record<AppPermission, boolean>>;
    permissions?: Partial<Record<AppPermission, boolean>>;
}

interface InviteResult {
    email: string;
    success: boolean;
    error?: string;
}

type TeamScope = 'agency' | 'clinic';

type TenantOption = {
    id: string;
    name: string;
    branding_config?: {
        displayName?: string;
    };
};

// Gera iniciais e cor consistente baseada no email
const getAvatarProps = (email: string) => {
    const initials = email.substring(0, 2).toUpperCase();
    const colors = [
        'from-violet-500 to-purple-600',
        'from-blue-500 to-cyan-500',
        'from-emerald-500 to-teal-500',
        'from-orange-500 to-amber-500',
        'from-pink-500 to-rose-500',
        'from-indigo-500 to-blue-500',
    ];
    const colorIndex = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return { initials, gradient: colors[colorIndex] };
};

// Valida formato de email
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Componente React `UsersPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const UsersPage: React.FC = () => {
    const pathname = usePathname();
    const { profile: currentUserProfile } = useAuth();
    const { tenant } = useTenant();
    const { addToast } = useToast();
    const isPlatformTeamPage = pathname?.startsWith('/platform/team') ?? false;
    const isAgencyAdmin = isAgencyAdminRole(currentUserProfile?.role);
    const [activeScope, setActiveScope] = useState<TeamScope>(isPlatformTeamPage ? 'agency' : 'clinic');
    const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
    const [tenantOptionsLoading, setTenantOptionsLoading] = useState(false);
    const [selectedClinicId, setSelectedClinicId] = useState<string | null>(tenant?.organizationId || null);
    const canManageUsers = isAgencyAdminRole(currentUserProfile?.role) || isClinicAdminRole(currentUserProfile?.role);
    const [users, setUsers] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newUserRole, setNewUserRole] = useState<AppUserRole>('clinic_staff');
    const [sendingInvites, setSendingInvites] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null); // id do usuário em ação
    const [userToDelete, setUserToDelete] = useState<Profile | null>(null);
    const [activeInvites, setActiveInvites] = useState<any[]>([]);
    const [expirationDays, setExpirationDays] = useState<number | null>(7); // 7 days default, null = never
    const [permissionLoading, setPermissionLoading] = useState<string | null>(null);
    const [roleLoading, setRoleLoading] = useState<string | null>(null);

    const sb = supabase;

    const effectiveScope: TeamScope = isPlatformTeamPage ? activeScope : 'clinic';
    const selectedClinic = tenantOptions.find((option) => option.id === selectedClinicId) || null;
    const roleOptions = useMemo(
        () =>
            getRoleOptions({
                actorRole: currentUserProfile?.role,
                managingOwnOrganization: effectiveScope === 'agency',
            }),
        [currentUserProfile?.role, effectiveScope]
    );
    const scopeQueryString = useMemo(() => {
        const params = new URLSearchParams();
        if (effectiveScope === 'agency') {
            params.set('scope', 'agency');
        } else if (selectedClinicId) {
            params.set('tenantId', selectedClinicId);
        }
        return params.toString();
    }, [effectiveScope, selectedClinicId]);

    const fetchUsers = useCallback(async () => {
        if (effectiveScope === 'clinic' && !selectedClinicId) {
            setUsers([]);
            setLoading(false);
            return;
        }
        try {
            const res = await fetch(`/api/admin/users${scopeQueryString ? `?${scopeQueryString}` : ''}`, {
                method: 'GET',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Falha ao carregar usuários (HTTP ${res.status})`);
            }

            setUsers(data?.users || []);
        } catch (err) {
            console.error('Error fetching users:', err);
            setUsers([]);
        } finally {
            setLoading(false);
        }
    }, [effectiveScope, scopeQueryString, selectedClinicId]);

    const fetchActiveInvites = useCallback(async () => {
        if (effectiveScope === 'clinic' && !selectedClinicId) {
            setActiveInvites([]);
            return;
        }
        try {
            const res = await fetch(`/api/admin/invites${scopeQueryString ? `?${scopeQueryString}` : ''}`, {
                method: 'GET',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Falha ao carregar convites (HTTP ${res.status})`);
            }

            const invites = data?.invites || [];
            const nowTs = Date.now();
            const validInvites = (invites || []).filter((invite: any) => {
                // Only show invites that are not used
                if (invite.used_at) return false;
                // If no expiration, it's valid
                if (!invite.expires_at) return true;
                // Check if expiration is in the future (with small buffer for timezone issues)
                const expiresTs = Date.parse(invite.expires_at);
                return expiresTs > nowTs;
            });
            // Force state update by creating new array reference
            setActiveInvites([...validInvites]);
        } catch (error) {
            console.error('Error fetching invites:', error);
            // On error, still try to update state to empty array to clear stale data
            setActiveInvites([]);
        }
    }, [effectiveScope, scopeQueryString, selectedClinicId]);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        setError(null);
        setNewUserRole(roleOptions[0]?.value || 'clinic_staff');
        setExpirationDays(7);
    }, [roleOptions]);

    const fetchTenantOptions = useCallback(async () => {
        if (!isAgencyAdmin) return;
        setTenantOptionsLoading(true);
        try {
            const res = await fetch('/api/platform/tenants', {
                method: 'GET',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || `Falha ao carregar clinicas (HTTP ${res.status})`);
            setTenantOptions(data?.tenants || []);
        } catch {
            setTenantOptions([]);
        } finally {
            setTenantOptionsLoading(false);
        }
    }, [isAgencyAdmin]);

    useEffect(() => {
        if (tenant?.organizationId) {
            setSelectedClinicId((current) => current || tenant.organizationId);
        }
    }, [tenant?.organizationId]);

    useEffect(() => {
        if (!isAgencyAdmin) return;
        void fetchTenantOptions();
    }, [fetchTenantOptions, isAgencyAdmin]);

    useEffect(() => {
        if (effectiveScope !== 'clinic') return;
        if (selectedClinicId) return;
        if (tenantOptions.length > 0) {
            setSelectedClinicId(tenantOptions[0].id);
        }
    }, [effectiveScope, selectedClinicId, tenantOptions]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    useEffect(() => {
        if (isModalOpen) {
            fetchActiveInvites();
        }
    }, [fetchActiveInvites, isModalOpen]);

    useEffect(() => {
        if (roleOptions.some((option) => option.value === newUserRole)) return;
        setNewUserRole(roleOptions[0]?.value || 'clinic_staff');
    }, [roleOptions, newUserRole]);

    if (!sb) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center max-w-md">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                        Configuração incompleta
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400">
                        O Supabase não está configurado neste ambiente. Configure as variáveis de ambiente para gerenciar usuários.
                    </p>
                </div>
            </div>
        );
    }

    const handleDeleteUser = (user: Profile) => {
        setUserToDelete(user);
    };

    const handlePermissionToggle = async (userId: string, permission: AppPermission, enabled: boolean) => {
        setPermissionLoading(`${userId}:${permission}`);
        try {
            const res = await fetch(`/api/admin/users/${userId}/permissions${scopeQueryString ? `?${scopeQueryString}` : ''}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    [permission]: enabled,
                    scope: effectiveScope,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Falha ao atualizar permissao (HTTP ${res.status})`);
            }

            setUsers((current) =>
                current.map((user) =>
                    user.id === userId
                        ? {
                            ...user,
                            permission_overrides: data?.permission_overrides || user.permission_overrides,
                            permissions: data?.permissions || user.permissions,
                        }
                        : user
                )
            );
            addToast('Permissao atualizada', 'success');
        } catch (err: any) {
            addToast(err.message || 'Erro ao atualizar permissao', 'error');
        } finally {
            setPermissionLoading(null);
        }
    };

    const handleRoleChange = async (userId: string, role: AppUserRole) => {
        setRoleLoading(userId);
        try {
            const res = await fetch(`/api/admin/users/${userId}${scopeQueryString ? `?${scopeQueryString}` : ''}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ role, scope: effectiveScope }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Falha ao atualizar cargo (HTTP ${res.status})`);
            }

            await fetchUsers();
            addToast('Cargo atualizado', 'success');
        } catch (err: any) {
            addToast(err.message || 'Erro ao atualizar cargo', 'error');
        } finally {
            setRoleLoading(null);
        }
    };

    const handleGenerateLink = async () => {
        setSendingInvites(true);
        setError(null);
        try {
            const expiresAt = expirationDays
                ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString()
                : null;

            const res = await fetch('/api/admin/invites', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    role: newUserRole,
                    expiresAt,
                    scope: effectiveScope,
                    tenantId: effectiveScope === 'clinic' ? selectedClinicId : null,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao gerar link (HTTP ${res.status})`);
            }

            // Force refresh of active invites and ensure state updates
            await fetchActiveInvites();
            
            // Small delay to ensure state propagation
            await new Promise(resolve => setTimeout(resolve, 100));
            
            addToast('Novo link gerado!', 'success');
        } catch (err: any) {
            setError(err.message || 'Erro ao gerar link');
        } finally {
            setSendingInvites(false);
        }
    };

    const handleDeleteInvite = async (id: string) => {
        try {
            const res = await fetch(`/api/admin/invites/${id}${scopeQueryString ? `?${scopeQueryString}` : ''}`, {
                method: 'DELETE',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao remover link (HTTP ${res.status})`);
            }

            await fetchActiveInvites();
            addToast('Link removido!', 'success');
        } catch (err: any) {
            addToast('Erro ao remover link', 'error');
        }
    };

    const copyLink = (token: string) => {
        const link = `${window.location.origin}/join?token=${token}`;
        navigator.clipboard.writeText(link);
        addToast('Link copiado!', 'success');
    };

    const confirmDeleteUser = async () => {
        if (!userToDelete) return;

        setActionLoading(userToDelete.id);
        setUserToDelete(null);

        try {
            const res = await fetch(`/api/admin/users/${userToDelete.id}${scopeQueryString ? `?${scopeQueryString}` : ''}`, {
                method: 'DELETE',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao remover usuário (HTTP ${res.status})`);
            }

            addToast(
                userToDelete.status === 'pending' ? 'Convite cancelado' : 'Usuário removido',
                'success'
            );
            fetchUsers();
        } catch (err: any) {
            addToast(`Erro: ${err.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="animate-spin h-8 w-8 text-primary-500" />
                    <span className="text-sm text-slate-500 dark:text-slate-400">Carregando equipe...</span>
                </div>
            </div>
        );
    }

    if (!canManageUsers) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
                        <KeyRound className="h-8 w-8 text-red-500" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">Acesso Restrito</h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                        Apenas administradores podem gerenciar usuários da equipe.
                    </p>
                </div>
            </div>
        );
    }

    const adminCount = users.filter((user) => {
        const role = normalizeAppUserRole(user.role);
        return role === 'agency_admin' || role === 'clinic_admin' || role === 'admin';
    }).length;
    const staffCount = users.length - adminCount;
    const pageTitle =
        effectiveScope === 'agency'
            ? 'Equipe da Agencia'
            : `Equipe da Clinica${selectedClinic?.branding_config?.displayName || selectedClinic?.name ? ` • ${selectedClinic?.branding_config?.displayName || selectedClinic?.name}` : ''}`;
    const isClinicScopeUnavailable = effectiveScope === 'clinic' && !selectedClinicId;

    return (
        <div className="max-w-4xl mx-auto pb-10">
            {/* Header */}
            <div className="mb-10">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
                            {pageTitle}
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
                            {users.length} {users.length === 1 ? 'membro' : 'membros'} • {adminCount} admin{adminCount !== 1 && 's'}, {staffCount} equipe
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        disabled={isClinicScopeUnavailable}
                        className="group flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-500 transition-all shadow-lg shadow-primary-600/25 hover:shadow-xl hover:shadow-primary-600/30 hover:-translate-y-0.5 font-medium"
                    >
                        <UserPlus className="w-4 h-4 transition-transform group-hover:scale-110" />
                        Convidar
                    </button>
                </div>
            </div>

            {/* User Grid */}
            <div className="grid gap-3">
                {users.map((user) => {
                    const { initials, gradient } = getAvatarProps(user.email);
                    const isCurrentUser = user.id === currentUserProfile?.id;
                    const normalizedRole = normalizeAppUserRole(user.role);
                    const isAdminRole = normalizedRole === 'agency_admin' || normalizedRole === 'clinic_admin' || normalizedRole === 'admin';

                    return (
                        <div
                            key={user.id}
                            className={`group relative bg-white dark:bg-white/[0.03] border rounded-2xl p-5 transition-all duration-200 hover:shadow-lg dark:hover:bg-white/[0.05] ${isCurrentUser
                                ? 'border-primary-200 dark:border-primary-500/30 ring-1 ring-primary-100 dark:ring-primary-500/10'
                                : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                {/* Avatar */}
                                <div className={`relative flex-shrink-0 h-14 w-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-lg shadow-lg`}>
                                    {initials}
                                    {isAdminRole && (
                                        <div className="absolute -top-1 -right-1 h-5 w-5 bg-amber-400 rounded-full flex items-center justify-center shadow-md ring-2 ring-white dark:ring-slate-900">
                                            <Crown className="h-3 w-3 text-amber-900" />
                                        </div>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                                            {user.email}
                                        </h3>
                                        {isCurrentUser && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                                                você
                                            </span>
                                        )}
                                        {user.status === 'pending' && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                <Clock className="h-3 w-3" />
                                                Pendente
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5">
                                        <span className={`inline-flex items-center gap-1.5 text-sm ${isAdminRole
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : 'text-slate-500 dark:text-slate-400'
                                            }`}>
                                            {isAdminRole ? (
                                                <>
                                                    <Crown className="h-3.5 w-3.5" />
                                                    {getRoleLabel(normalizedRole)}
                                                </>
                                            ) : (
                                                <>
                                                    <Briefcase className="h-3.5 w-3.5" />
                                                    {getRoleLabel(normalizedRole)}
                                                </>
                                            )}
                                        </span>
                                        <span className="text-slate-300 dark:text-slate-600">•</span>
                                        <span className="text-sm text-slate-400 dark:text-slate-500">
                                            {user.status === 'pending'
                                                ? `Convidado ${new Date(user.invited_at || user.created_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`
                                                : `Desde ${new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`
                                            }
                                        </span>
                                    </div>
                                </div>

                                {/* Actions */}
                                {!isCurrentUser && (
                                    <div className="flex items-center gap-1">
                                        {actionLoading === user.id || roleLoading === user.id ? (
                                            <div className="p-2">
                                                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                            </div>
                                        ) : (
                                            <>
                                                {/* Resend Invite removed as we don't use email invites anymore */}
                                                <button
                                                    onClick={() => handleDeleteUser(user)}
                                                    className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                                    title={user.status === 'pending' ? 'Cancelar convite' : 'Remover usuário'}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                            Cargo e escopo
                                        </div>
                                        <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                            Agencia ou clinica, com alteracao posterior por voce quando houver promocao ou mudanca de funcao.
                                        </div>
                                    </div>

                                    {isCurrentUser ? (
                                        <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                            voce
                                        </span>
                                    ) : (
                                        <select
                                            value={normalizedRole}
                                            disabled={roleLoading === user.id}
                                            onChange={(event) => void handleRoleChange(user.id, event.target.value as AppUserRole)}
                                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-primary-500 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
                                        >
                                            {roleOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            </div>

                            <div className="mt-5 grid gap-3 md:grid-cols-2">
                                {PERMISSION_DEFINITIONS.map((permission) => {
                                    const checked = Boolean(user.permissions?.[permission.key]);
                                    const isSwitchLoading = permissionLoading === `${user.id}:${permission.key}`;

                                    return (
                                        <div
                                            key={permission.key}
                                            className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                                        {permission.label}
                                                    </div>
                                                    <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                                        {permission.description}
                                                    </div>
                                                </div>

                                                {isCurrentUser ? (
                                                    <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                                        voce
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={checked}
                                                        disabled={isSwitchLoading}
                                                        onClick={() => void handlePermissionToggle(user.id, permission.key, !checked)}
                                                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
                                                            checked
                                                                ? 'border-emerald-500 bg-emerald-500'
                                                                : 'border-slate-300 bg-slate-200 dark:border-white/15 dark:bg-white/10'
                                                        } ${isSwitchLoading ? 'cursor-wait opacity-70' : ''}`}
                                                    >
                                                        <span
                                                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                                                checked ? 'translate-x-6' : 'translate-x-1'
                                                            }`}
                                                        />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Empty State */}
            {users.length === 0 && (
                <div className="text-center py-16">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 dark:bg-white/5 mb-4">
                        <UserPlus className="h-10 w-10 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Nenhum membro ainda</h3>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                        Comece convidando membros da sua equipe para colaborar no CRM.
                    </p>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-500 transition-all font-medium"
                    >
                        <UserPlus className="w-4 h-4" />
                        Convidar primeiro membro
                    </button>
                </div>
            )}

            {/* Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
                    onClick={(e) => {
                        // Close only when clicking the backdrop (outside the panel).
                        if (e.target === e.currentTarget) closeModal();
                    }}
                >
                    <div
                        className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center gap-3 mb-1">
                                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/25">
                                    <Link className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 dark:text-white font-display">
                                        Gerar Convite
                                    </h2>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        Crie links de acesso para sua equipe
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="px-6 pb-6">
                            {isPlatformTeamPage ? (
                                <div className="mb-6 space-y-3">
                                    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/5">
                                        <button
                                            type="button"
                                            onClick={() => setActiveScope('agency')}
                                            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                                                effectiveScope === 'agency'
                                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                                                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                                            }`}
                                        >
                                            Convites da agencia
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveScope('clinic')}
                                            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                                                effectiveScope === 'clinic'
                                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                                                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                                            }`}
                                        >
                                            Convites da clinica
                                        </button>
                                    </div>

                                    {effectiveScope === 'clinic' ? (
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                                Clinica alvo
                                            </label>
                                            <select
                                                value={selectedClinicId || ''}
                                                onChange={(event) => setSelectedClinicId(event.target.value || null)}
                                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                disabled={tenantOptionsLoading}
                                            >
                                                {!selectedClinicId ? <option value="">Selecione uma clinica</option> : null}
                                                {tenantOptions.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.branding_config?.displayName || option.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                                Separe os convites da agencia dos convites de cada clinica sem misturar os acessos.
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Aqui voce cria links apenas para a equipe interna da agencia.
                                        </p>
                                    )}
                                </div>
                            ) : null}

                            {/* Active Links List */}
                            <div className="mb-6">
                                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
                                    Links Ativos
                                </h3>

                                {activeInvites.length > 0 ? (
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                        {activeInvites.map((invite) => (
                                            <div key={invite.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${normalizeAppUserRole(invite.role) === 'agency_admin' || normalizeAppUserRole(invite.role) === 'clinic_admin' || normalizeAppUserRole(invite.role) === 'admin'
                                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                                            : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                                                            }`}>
                                                            {getRoleLabel(invite.role)}
                                                        </span>
                                                        <span className="text-xs text-slate-400">
                                                            {invite.expires_at
                                                                ? `Expira em ${new Date(invite.expires_at).toLocaleDateString()}`
                                                                : 'Nunca expira'
                                                            }
                                                        </span>
                                                    </div>
                                                    <code className="block text-xs text-slate-600 dark:text-slate-300 truncate">
                                                        ...{invite.token.slice(-8)}
                                                    </code>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => copyLink(invite.token)}
                                                        className="p-2 text-primary-600 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
                                                        title="Copiar link"
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteInvite(invite.id)}
                                                        className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                        title="Revogar link"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Nenhum link ativo
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-5 border-t border-slate-100 dark:border-white/5 pt-5">
                                {/* Role Selection */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                        Cargo
                                    </label>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        {roleOptions.map((option) => {
                                            const isAdminOption = option.value === 'agency_admin' || option.value === 'clinic_admin' || option.value === 'admin';
                                            const isSelected = newUserRole === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => setNewUserRole(option.value)}
                                                    className={`relative p-3 rounded-xl border-2 text-left transition-all ${isSelected
                                                        ? isAdminOption
                                                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                                                            : 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                        {isAdminOption ? (
                                                            <Crown className={`h-4 w-4 ${isSelected ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`} />
                                                        ) : (
                                                            <Briefcase className={`h-4 w-4 ${isSelected ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}`} />
                                                        )}
                                                        <span className={`font-medium text-sm ${isSelected
                                                            ? isAdminOption
                                                                ? 'text-amber-900 dark:text-amber-100'
                                                                : 'text-primary-900 dark:text-primary-100'
                                                            : 'text-slate-700 dark:text-slate-300'
                                                            }`}>
                                                            {option.label}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                                                        {option.description}
                                                    </p>
                                                    {isSelected && (
                                                        <div className={`absolute top-2 right-2 h-2 w-2 rounded-full ${isAdminOption ? 'bg-amber-500' : 'bg-primary-500'}`} />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Expiration Selection */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                        Expiração
                                    </label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { label: '7 dias', value: 7 },
                                            { label: '30 dias', value: 30 },
                                            { label: 'Nunca', value: null }
                                        ].map((opt) => (
                                            <button
                                                key={opt.label}
                                                type="button"
                                                onClick={() => setExpirationDays(opt.value)}
                                                className={`py-2 px-3 rounded-lg text-sm font-medium border transition-all ${expirationDays === opt.value
                                                    ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Error Message */}
                                {error && (
                                    <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm">
                                        <div className="h-5 w-5 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <span className="text-xs">!</span>
                                        </div>
                                        <span>{error}</span>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="flex gap-3 mt-8 pt-6 border-t border-slate-100 dark:border-white/5">
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                                >
                                    Fechar
                                </button>

                                <button
                                    onClick={handleGenerateLink}
                                    disabled={sendingInvites || isClinicScopeUnavailable}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-600/25 transition-all"
                                >
                                    {sendingInvites ? (
                                        <>
                                            <Loader2 className="animate-spin h-4 w-4" />
                                            Gerando...
                                        </>
                                    ) : (
                                        <>
                                            <Link className="h-4 w-4" />
                                            Gerar Link
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={!!userToDelete}
                onClose={() => setUserToDelete(null)}
                onConfirm={confirmDeleteUser}
                title={userToDelete?.status === 'pending' ? 'Cancelar Convite' : 'Remover Usuário'}
                message={userToDelete?.status === 'pending'
                    ? `Tem certeza que deseja cancelar o convite para ${userToDelete?.email}?`
                    : `Tem certeza que deseja remover ${userToDelete?.email} da equipe?`
                }
                confirmText={userToDelete?.status === 'pending' ? 'Cancelar Convite' : 'Remover'}
                cancelText="Voltar"
                variant="danger"
            />
        </div>
    );
};
