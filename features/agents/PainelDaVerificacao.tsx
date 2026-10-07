'use client';

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ResultadoDaVerificacao } from '@/lib/agents/verificarPrompt';

export function PainelDaVerificacao({ verificacao }: { verificacao: ResultadoDaVerificacao }) {
  const { erros, avisos, informacoes } = verificacao;
  return (
    <section aria-label="Verificação" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-card">
      <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Verificação</h2>
      {erros.length + avisos.length + informacoes.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 size={16} aria-hidden="true" />
          Nenhum erro nem aviso.
        </p>
      ) : (
        <ul className="space-y-2">
          {erros.map((item) => (
            <li key={item.codigo} className="flex gap-2 text-sm text-rose-800 dark:text-rose-200">
              <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="font-semibold">Erro:</strong> {item.mensagem}</span>
            </li>
          ))}
          {avisos.map((item) => (
            <li key={item.codigo} className="flex gap-2 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="font-semibold">Aviso:</strong> {item.mensagem}</span>
            </li>
          ))}
          {informacoes.map((item) => (
            <li key={item.codigo} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="font-semibold">Informação:</strong> {item.mensagem}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function resumoDaVerificacao(v: ResultadoDaVerificacao): string {
  const partes: string[] = [];
  if (v.erros.length > 0) partes.push(v.erros.length === 1 ? '1 erro' : `${v.erros.length} erros`);
  if (v.avisos.length > 0) partes.push(v.avisos.length === 1 ? '1 aviso' : `${v.avisos.length} avisos`);
  return partes.length > 0 ? `Verificação: ${partes.join(' · ')}` : 'Verificação sem erro nem aviso';
}
