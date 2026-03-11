/**
 * @fileoverview Hook de Estado Persistido em localStorage
 *
 * Hook utilitário que sincroniza estado React com localStorage,
 * mantendo dados entre sessões do navegador.
 *
 * Suporta versionamento de schema para migrações seguras.
 *
 * @module hooks/usePersistedState
 *
 * @example
 * ```tsx
 * function SettingsPanel() {
 *   // Uso básico (retrocompatível)
 *   const [theme, setTheme] = usePersistedState('app-theme', 'light');
 *
 *   // Com versionamento (recomendado para dados estruturados)
 *   const [filters, setFilters] = usePersistedState('deal-filters', {}, { version: 1 });
 *
 *   return (
 *     <select value={theme} onChange={e => setTheme(e.target.value)}>
 *       <option value="light">Claro</option>
 *       <option value="dark">Escuro</option>
 *     </select>
 *   );
 * }
 * ```
 */

import React, { useState, useEffect } from 'react';

/**
 * Opções para usePersistedState
 */
export interface UsePersistedStateOptions {
  /**
   * Versão do schema dos dados.
   * Quando a versão muda, o dado antigo é ignorado e o initialValue é usado.
   * Isso previne bugs quando a estrutura dos dados muda.
   *
   * @example
   * // Versão 1: { theme: 'dark' }
   * // Versão 2: { theme: 'dark', fontSize: 14 } <- nova propriedade
   * usePersistedState('settings', defaultSettings, { version: 2 });
   */
  version?: number;
}

/**
 * Hook para estado persistido em localStorage
 *
 * Funciona como useState mas automaticamente salva e recupera
 * o valor do localStorage usando a chave fornecida.
 *
 * @template T - Tipo do estado (deve ser serializável em JSON)
 * @param {string} key - Chave única no localStorage
 * @param {T} initialValue - Valor inicial se não houver dado salvo
 * @param {UsePersistedStateOptions} options - Opções (opcional)
 * @returns {[T, React.Dispatch<React.SetStateAction<T>>]} Tupla [estado, setter]
 *
 * @example
 * ```tsx
 * // Uso básico (sem versionamento)
 * const [theme, setTheme] = usePersistedState('theme', 'light');
 *
 * // Com versionamento (recomendado)
 * const [prefs, setPrefs] = usePersistedState('user-prefs', {
 *   showCompleted: true,
 *   sortBy: 'date',
 * }, { version: 1 });
 *
 * // Quando mudar o schema, incremente a versão:
 * const [prefs, setPrefs] = usePersistedState('user-prefs', {
 *   showCompleted: true,
 *   sortBy: 'date',
 *   fontSize: 14,  // nova propriedade
 * }, { version: 2 });  // <- usuários com v1 receberão o novo default
 * ```
 *
 * @remarks
 * - Usa JSON.stringify/parse para serialização
 * - Falhas silenciosas em caso de erro (retorna initialValue)
 * - Atualiza localStorage sempre que estado muda
 * - Com version: chave é prefixada com :v{N} para evitar conflitos
 */
export const usePersistedState = <T>(
  key: string,
  initialValue: T,
  options?: UsePersistedStateOptions
): [T, React.Dispatch<React.SetStateAction<T>>] => {
  // Chave versionada: "my-key" -> "my-key:v1" (se version fornecida)
  const storageKey = options?.version ? `${key}:v${options.version}` : key;

  const [state, setState] = useState<T>(() => {
    // SSR safety: only access localStorage in browser
    if (typeof window === 'undefined') {
      return initialValue;
    }
    try {
      const item = localStorage.getItem(storageKey);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      // Em caso de erro de parse (JSON inválido), retorna valor inicial
      // Isso pode acontecer se o schema mudou e o dado antigo é incompatível
      console.error(`Error reading localStorage key "${storageKey}":`, error);
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const item = localStorage.getItem(storageKey);
      setState(item ? JSON.parse(item) : initialValue);
    } catch (error) {
      console.error(`Error reloading localStorage key "${storageKey}":`, error);
      setState(initialValue);
    }
  }, [storageKey, initialValue]);

  useEffect(() => {
    // SSR safety: only access localStorage in browser
    if (typeof window === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {
      // localStorage pode falhar por quota excedida ou modo privado
      console.error(`Error writing localStorage key "${storageKey}":`, error);
    }
  }, [storageKey, state]);

  return [state, setState];
};
