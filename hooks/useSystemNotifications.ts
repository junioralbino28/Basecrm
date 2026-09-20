import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useMemo } from 'react';

export interface SystemNotification {
    id: string;
    type: string; // 'SYSTEM_ALERT' | 'SYSTEM_INFO' | 'SYSTEM_WARNING' | 'SYSTEM_SUCCESS' etc
    title: string;
    message: string;
    timestamp: Date;
    actionLink?: string;
    severity: 'high' | 'medium' | 'low';
    readAt?: string | null;
}

/**
 * Hook React `useSystemNotifications` que encapsula uma lógica reutilizável.
 * @returns {{ notifications: { id: string; type: string; title: string; message: string; timestamp: Date; actionLink: string | undefined; severity: "low" | "medium" | "high"; readAt: string | null | undefined; }[]; count: number; hasHighSeverity: boolean; markAsRead: UseMutateFunction<...>; markAllAsRead: UseMutateFunction<...>...} Retorna um valor do tipo `{ notifications: { id: string; type: string; title: string; message: string; timestamp: Date; actionLink: string | undefined; severity: "low" | "medium" | "high"; readAt: string | null | undefined; }[]; count: number; hasHighSeverity: boolean; markAsRead: UseMutateFunction<...>; markAllAsRead: UseMutateFunction<...>...`.
 */
export const useSystemNotifications = () => {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const sb = supabase;

    const { data: notifications = [], isFetched: notificationsReady } = useQuery({
        queryKey: ['system_notifications'],
        queryFn: async () => {
            if (!sb) return [];
            // Fetch System Notifications
            const { data, error } = await sb
                .from('system_notifications')
                .select('id,type,title,message,created_at,link,severity,read_at')
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;

            type NotificationRow = {
                id: string;
                type: string;
                title: string;
                message: string;
                created_at: string;
                link?: string;
                severity: string;
                read_at?: string | null;
            };

            return (data as NotificationRow[]).map(n => ({
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.message,
                timestamp: new Date(n.created_at),
                actionLink: n.link,
                severity: n.severity as 'high' | 'medium' | 'low',
                readAt: n.read_at
            }));
        },
        enabled: !!user && !!sb,
        refetchInterval: 15_000,
        refetchIntervalInBackground: true,
        staleTime: 10_000,
    });

    // Derived state
    const unreadCount = useMemo(() =>
        notifications.filter(n => !n.readAt).length
        , [notifications]);

    const hasHighSeverity = useMemo(() =>
        notifications.some(n => n.severity === 'high' && !n.readAt)
        , [notifications]);

    // Mutation to mark as read
    const markAsRead = useMutation({
        mutationFn: async (id: string) => {
            if (!sb) throw new Error('Supabase não está configurado');
            const { error } = await sb
                .from('system_notifications')
                .update({ read_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['system_notifications'] });
        }
    });

    const markAllAsRead = useMutation({
        mutationFn: async () => {
            // Naive implementation: update all displayed unread. 
            // Faster would be a single query update where read_at is null.
            if (!sb) throw new Error('Supabase não está configurado');
            const { error } = await sb
                .from('system_notifications')
                .update({ read_at: new Date().toISOString() })
                .is('read_at', null);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['system_notifications'] });
        }
    });

    return {
        notifications,
        notificationsReady,
        count: unreadCount,
        hasHighSeverity,
        markAsRead: markAsRead.mutate,
        markAllAsRead: markAllAsRead.mutate
    };
};
