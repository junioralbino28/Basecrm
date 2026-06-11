'use client';

import React from 'react';
import { useAgendaController } from './hooks/useAgendaController';
import { AgendaDayView } from './components/AgendaDayView';
import { AgendaBookModal } from './components/AgendaBookModal';
import { useProfessionals } from '@/lib/query/hooks';
import { useProducts } from '@/lib/query/hooks/useProductsQuery';

export function AgendaPage() {
  const controller = useAgendaController();
  const { data: professionals = [] } = useProfessionals();
  const { data: products = [] } = useProducts();

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <input
          type="date"
          value={controller.date}
          onChange={(e) => controller.goToDate(e.target.value)}
          className="rounded border p-2 text-sm"
          aria-label="Data da agenda"
        />
      </header>

      <AgendaDayView
        date={controller.date}
        appointments={controller.appointments}
        availableSlots={controller.availableSlots}
        loading={controller.loading}
        error={controller.error}
        onBookSlot={controller.openBookModal}
      />

      <AgendaBookModal
        slot={controller.bookSlot}
        professionals={professionals}
        products={products}
        onClose={controller.closeBookModal}
        onConfirm={controller.book}
      />
    </div>
  );
}
