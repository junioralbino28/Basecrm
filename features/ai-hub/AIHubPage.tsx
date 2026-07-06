'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Settings, AlertCircle } from 'lucide-react';
import { useSettings } from '@/context/settings/SettingsContext';
import { UIChat } from '@/components/ai/UIChat';

// Componente de bloqueio quando a IA ainda não está configurada.
const APINotConfigured: React.FC = () => {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] max-w-lg mx-auto px-4">
      <div className="text-center">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white mb-6 shadow-lg shadow-orange-500/30">
          <AlertCircle size={40} />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
          Configure a Inteligência Artificial
        </h1>

        {/* Description */}
        <p className="text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">
          Para usar o assistente de IA, você precisa configurar uma chave de API.
          Suportamos <strong className="text-slate-800 dark:text-slate-200">Google Gemini</strong>, <strong className="text-slate-800 dark:text-slate-200">OpenAI</strong> e <strong className="text-slate-800 dark:text-slate-200">Anthropic</strong>.
        </p>

        {/* Card with instructions */}
        <div className="bg-slate-50 dark:bg-white/5 rounded-2xl p-6 border border-slate-200 dark:border-white/10 mb-6 text-left">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            Como configurar:
          </h3>
          <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <li className="flex gap-2">
              <span className="font-bold text-purple-500">1.</span>
              Acesse as Configurações
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-purple-500">2.</span>
              Vá em "Inteligência Artificial"
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-purple-500">3.</span>
              Escolha um provedor e insira sua API Key
            </li>
          </ol>
        </div>

        {/* CTA Button */}
        <button
          onClick={() => router.push('/settings/ai#ai-config')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-purple-500/25 transition-all active:scale-95"
        >
          <Settings size={18} />
          Ir para Configurações
        </button>
      </div>
    </div>
  );
};

/**
 * Página do Hub de IA (rota `/ai`).
 *
 * Fix do achado C1: antes rodava a inferência no BROWSER (`useCRMAgent` + `streamText`
 * com a chave crua lida das configurações). Agora renderiza o `<UIChat>`, que conversa
 * com a rota server `/api/ai/chat` (`createCRMAgent`) — a chave da IA fica 100% no
 * servidor. O gate usa `aiKeyConfigured` (booleano), já que o GET das configurações não
 * devolve mais a chave crua ao navegador.
 */
export const AIHubPage: React.FC = () => {
  const { aiKeyConfigured } = useSettings();

  if (!aiKeyConfigured) {
    return <APINotConfigured />;
  }

  return (
    <div className="h-[calc(100vh-120px)] max-w-4xl mx-auto">
      <UIChat />
    </div>
  );
};

export default AIHubPage;
