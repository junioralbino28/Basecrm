/**
 * @fileoverview Configuração de provedores de IA para o CRM.
 * 
 * Este módulo abstrai a criação de clientes de diferentes provedores de IA
 * (Google Gemini, OpenAI, Anthropic Claude), permitindo trocar entre eles
 * de forma transparente.
 * 
 * @module services/ai/config
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_DEFAULT_MODELS } from './defaults';

/**
 * Provedores de IA suportados pelo sistema.
 * 
 * @typedef {'google' | 'openai' | 'anthropic'} AIProvider
 */
export type AIProvider = 'google' | 'openai' | 'anthropic';

/**
 * Cria e retorna uma instância do modelo de IA configurada.
 * 
 * Suporta múltiplos provedores com modelos padrão:
 * - Google: gemini-3-flash-preview
 * - OpenAI: gpt-4o
 * - Anthropic: claude-3-5-sonnet-20240620
 * 
 * @param provider - Provedor de IA a ser utilizado.
 * @param apiKey - Chave de API do provedor.
 * @param modelId - ID do modelo específico (opcional, usa padrão se não informado).
 * @returns Instância configurada do modelo de IA.
 * @throws Error se a API key não for fornecida ou provedor não for suportado.
 * 
 * @example
 * ```typescript
 * // Usando Google Gemini
 * const model = getModel('google', 'sua-api-key', 'gemini-3-pro-preview');
 * 
 * // Usando OpenAI com modelo padrão
 * const model = getModel('openai', 'sua-api-key', '');
 * ```
 */
export const getModel = (
    provider: AIProvider,
    apiKey: string,
    modelId: string,
    // fetch proprio (opcional): quem mede a resposta da IA conta aqui as chamadas HTTP ao provedor,
    // inclusive as novas tentativas que o SDK faz sozinho (ver lib/ai/medicaoResposta.ts).
    options?: { fetch?: typeof fetch },
) => {
    if (!apiKey) {
        throw new Error('API Key is missing');
    }
    const fetchOpcional = options?.fetch ? { fetch: options.fetch } : {};

    switch (provider) {
        case 'google':
            const google = createGoogleGenerativeAI({ apiKey, ...fetchOpcional });
            return google(modelId || AI_DEFAULT_MODELS.google);

        case 'openai':
            const openai = createOpenAI({ apiKey, ...fetchOpcional });
            return openai(modelId || AI_DEFAULT_MODELS.openai);

        case 'anthropic':
            const anthropic = createAnthropic({ apiKey, ...fetchOpcional });
            return anthropic(modelId || AI_DEFAULT_MODELS.anthropic);

        default:
            throw new Error(`Provider ${provider} not supported`);
    }
};
