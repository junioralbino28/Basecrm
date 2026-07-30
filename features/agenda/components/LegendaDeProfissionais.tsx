'use client';

/**
 * Legenda da visão "Todos": liga cada cor ao nome do dentista. Sem ela a cor
 * vira enfeite — a recepção precisa saber de quem é a faixa colorida sem ter
 * que abrir a consulta.
 */
import React from 'react';
import type { Professional } from '@/types';
import { corDoProfissional } from './agendaFormato';

export function LegendaDeProfissionais({ professionals }: { professionals: Professional[] }) {
  if (professionals.length === 0) return null;
  return (
    <ul aria-label="Cor de cada profissional" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {professionals.map((pro) => (
        <li key={pro.id} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${corDoProfissional(pro.id).ponto}`}
            aria-hidden
          />
          {pro.name}
        </li>
      ))}
    </ul>
  );
}
