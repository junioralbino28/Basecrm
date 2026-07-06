/**
 * @fileoverview Contexto de Notificações Toast
 * 
 * Provider React que fornece sistema de notificações toast acessível,
 * com suporte a diferentes tipos (success, error, warning, info) e
 * auto-dismiss configurável.
 * 
 * @module context/ToastContext
 * 
 * Recursos de Acessibilidade (WCAG 2.1):
 * - aria-live="polite" para notificações não-críticas
 * - role="alert" para erros (assertive)
 * - Cada toast tem role="status" ou "alert" apropriado
 * - Botão de fechar com label acessível
 * 
 * @example
 * ```tsx
 * // No App.tsx
 * <ToastProvider>
 *   <App />
 * </ToastProvider>
 * 
 * // Em qualquer componente
 * function SaveButton() {
 *   const { addToast } = useToast();
 *   
 *   const handleSave = async () => {
 *     try {
 *       await save();
 *       addToast('Salvo com sucesso!', 'success');
 *     } catch {
 *       addToast('Erro ao salvar', 'error');
 *     }
 *   };
 *   
 *   return <button onClick={handleSave}>Salvar</button>;
 * }
 * ```
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

/** Tipos de notificação toast */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Estrutura de uma notificação toast
 * 
 * @interface Toast
 * @property {string} id - Identificador único gerado automaticamente
 * @property {string} message - Mensagem da notificação
 * @property {ToastType} type - Tipo visual e semântico
 */
export interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

/**
 * Tipo do contexto de toast
 * 
 * @interface ToastContextType
 * @property {(message: string, type?: ToastType) => void} addToast - Adiciona notificação
 * @property {(id: string) => void} removeToast - Remove notificação por ID
 */
interface ToastContextType {
    addToast: (message: string, type?: ToastType) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

/**
 * Provider de notificações toast acessíveis
 * 
 * Gerencia lista de toasts com auto-dismiss após 3 segundos.
 * Renderiza toasts no canto inferior direito da tela.
 * 
 * @param {Object} props - Props do componente
 * @param {ReactNode} props.children - Componentes filhos
 */
export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);

        // Auto remove after 3 seconds
        setTimeout(() => {
            removeToast(id);
        }, 3000);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    // Get accessible role based on toast type
    const getToastRole = (type: ToastType): 'alert' | 'status' => {
        return type === 'error' ? 'alert' : 'status';
    };

    // Get aria-live based on toast type (errors are assertive)
    const getAriaLive = (type: ToastType): 'assertive' | 'polite' => {
        return type === 'error' ? 'assertive' : 'polite';
    };

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            <div 
                className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
                role="region"
                aria-label="Notificações"
            >
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        role={getToastRole(toast.type)}
                        aria-live={getAriaLive(toast.type)}
                        aria-atomic="true"
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border transition-all animate-in slide-in-from-right-full duration-300 ${toast.type === 'success' ? 'bg-white dark:bg-surface border-green-500 text-green-600 dark:text-green-400' :
                                toast.type === 'error' ? 'bg-white dark:bg-surface border-red-500 text-red-600 dark:text-red-400' :
                                    toast.type === 'warning' ? 'bg-white dark:bg-surface border-yellow-500 text-yellow-600 dark:text-yellow-400' :
                                        'bg-white dark:bg-surface border-blue-500 text-blue-600 dark:text-blue-400'
                            }`}
                    >
                        {toast.type === 'success' && <CheckCircle size={18} aria-hidden="true" />}
                        {toast.type === 'error' && <AlertCircle size={18} aria-hidden="true" />}
                        {toast.type === 'warning' && <AlertCircle size={18} aria-hidden="true" />}
                        {toast.type === 'info' && <Info size={18} aria-hidden="true" />}
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{toast.message}</span>
                        <button 
                            type="button"
                            onClick={() => removeToast(toast.id)} 
                            aria-label={`Fechar notificação: ${toast.message}`}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus-visible-ring rounded p-0.5"
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

/**
 * Hook para acessar sistema de notificações toast
 * 
 * Fornece funções para adicionar e remover toasts.
 * Deve ser usado dentro de um ToastProvider.
 * 
 * @returns {Object} Funções de controle de toast
 * @returns {(message: string, type?: ToastType) => void} return.addToast - Adiciona toast
 * @returns {(message: string, type?: ToastType) => void} return.showToast - Alias para addToast
 * @returns {(id: string) => void} return.removeToast - Remove toast específico
 * @throws {Error} Se usado fora do ToastProvider
 * 
 * @example
 * ```tsx
 * function ActionButton() {
 *   const { addToast, showToast } = useToast();
 *   
 *   // Ambas as sintaxes funcionam
 *   addToast('Ação realizada!', 'success');
 *   showToast('Ação realizada!', 'success');
 * }
 * ```
 */
export const useToast = () => {
    const context = useContext(ToastContext);
    if (context === undefined) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    // Alias for compatibility
    return {
        ...context,
        showToast: context.addToast
    };
};

/**
 * Hook opcional para toast.
 *
 * Útil em componentes que podem ser renderizados em testes/ambientes
 * sem ToastProvider. Retorna funções no-op quando o provider não existe.
 */
export const useOptionalToast = () => {
    const context = useContext(ToastContext);
    const noop = () => {
        // no-op
    };

    return {
        addToast: context?.addToast ?? noop,
        removeToast: context?.removeToast ?? noop,
        showToast: context?.addToast ?? noop,
    };
};
