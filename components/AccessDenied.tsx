'use client';

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

type AccessDeniedProps = {
  title?: string;
  message: string;
  icon?: ReactNode;
};

export function AccessDenied({
  title = 'Acesso restrito',
  message,
  icon,
}: AccessDeniedProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass p-8 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm max-w-xl mx-auto mt-10 text-center"
    >
      {icon ?? <Lock size={32} className="mx-auto mb-3 text-slate-400" aria-hidden="true" />}
      <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
        {title}
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{message}</p>
    </div>
  );
}
