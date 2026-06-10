/**
 * @fileoverview Contexto de Tema (Dark Mode)
 * 
 * Provider React que gerencia preferência de tema (claro/escuro) com
 * persistência em localStorage e sincronização com classe CSS do documento.
 * 
 * @module context/ThemeContext
 * 
 * @example
 * ```tsx
 * // No App.tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * 
 * // Em qualquer componente
 * function ThemeToggle() {
 *   const { darkMode, toggleDarkMode } = useTheme();
 *   
 *   return (
 *     <button onClick={toggleDarkMode}>
 *       {darkMode ? '☀️ Claro' : '🌙 Escuro'}
 *     </button>
 *   );
 * }
 * ```
 */

import React, { createContext, useContext, useEffect, useCallback, useRef, useState, ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';

const THEME_STORAGE_KEY = 'crm_dark_mode';

/**
 * Tipo do contexto de tema
 *
 * @interface ThemeContextType
 * @property {boolean} darkMode - Se o modo escuro está ativo
 * @property {() => void} toggleDarkMode - Alterna entre claro e escuro
 * @property {(dark: boolean) => void} applyRoleDefault - Aplica o default de tema
 *   por role (ex.: clínica nasce no claro). Só tem efeito se o usuário ainda não
 *   tiver preferência salva em localStorage; o toggle continua mandando.
 */
interface ThemeContextType {
  darkMode: boolean;
  toggleDarkMode: () => void;
  applyRoleDefault: (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Provider de tema da aplicação
 * 
 * Gerencia preferência de tema e aplica classe 'dark' ao documento.
 * O tema é persistido em localStorage com a chave 'crm_dark_mode'.
 * O padrão é modo escuro (true).
 * 
 * @param {Object} props - Props do componente
 * @param {ReactNode} props.children - Componentes filhos
 */
export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [darkMode, setDarkMode] = usePersistedState<boolean>(THEME_STORAGE_KEY, true);

  // Captura se já havia preferência salva ANTES do usePersistedState persistir
  // o valor default (o hook grava no localStorage logo no mount).
  const [hadStoredPreference] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) !== null;
    } catch {
      return true;
    }
  });
  const roleDefaultApplied = useRef(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode(!darkMode);

  const applyRoleDefault = useCallback((dark: boolean) => {
    if (hadStoredPreference || roleDefaultApplied.current) return;
    roleDefaultApplied.current = true;
    setDarkMode(dark);
  }, [hadStoredPreference, setDarkMode]);

  return (
    <ThemeContext.Provider value={{ darkMode, toggleDarkMode, applyRoleDefault }}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Hook para acessar contexto de tema
 * 
 * Retorna estado do tema e função para alternar.
 * Deve ser usado dentro de um ThemeProvider.
 * 
 * @returns {ThemeContextType} Estado e controles do tema
 * @throws {Error} Se usado fora do ThemeProvider
 * 
 * @example
 * ```tsx
 * function Header() {
 *   const { darkMode } = useTheme();
 *   return <header className={darkMode ? 'bg-slate-900' : 'bg-white'}>...</header>;
 * }
 * ```
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
