'use client';

import React, { useState } from 'react';
import type { ClinicorpAvailableTime } from '@/lib/channels/clinicorpTypes';
import type { Professional, Product } from '@/types';

export interface AgendaBookModalProps {
  slot: ClinicorpAvailableTime | null;
  professionals: Professional[];
  products: Product[];
  onClose: () => void;
  onConfirm: (payload: {
    dentistPersonId: number;
    patientName?: string;
    patientMobilePhone?: string;
    procedimento: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function AgendaBookModal({ slot, professionals, products, onClose, onConfirm }: AgendaBookModalProps) {
  const [dentistExternalId, setDentistExternalId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [procedimento, setProcedimento] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!slot) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const dentistPersonId = Number(dentistExternalId);
    if (!Number.isFinite(dentistPersonId) || dentistPersonId <= 0) {
      setError('Selecione um dentista.');
      return;
    }
    if (!procedimento.trim()) {
      setError('Informe o procedimento.');
      return;
    }
    setSubmitting(true);
    const result = await onConfirm({
      dentistPersonId,
      patientName: patientName.trim() || undefined,
      patientMobilePhone: patientPhone.trim() || undefined,
      procedimento: procedimento.trim(),
    });
    setSubmitting(false);
    if (!result.ok) setError(result.error || 'Falha ao agendar.');
  };

  return (
    <div role="dialog" aria-label="Agendar horário" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">Agendar {slot.From}</h2>

        <label className="mb-3 block text-sm">
          Dentista
          <select
            value={dentistExternalId}
            onChange={(e) => setDentistExternalId(e.target.value)}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="">Selecione…</option>
            {professionals
              .filter((p) => p.externalId)
              .map((p) => (
                <option key={p.id} value={String(p.externalId)}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          Paciente (nome)
          <input value={patientName} onChange={(e) => setPatientName(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>

        <label className="mb-3 block text-sm">
          Telefone
          <input value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>

        <label className="mb-4 block text-sm">
          Procedimento
          <select value={procedimento} onChange={(e) => setProcedimento(e.target.value)} className="mt-1 w-full rounded border p-2">
            <option value="">Selecione…</option>
            {products.map((product) => (
              <option key={product.id} value={product.name}>
                {product.name}
              </option>
            ))}
          </select>
        </label>

        {error ? <p role="alert" className="mb-3 text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={submitting} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
            {submitting ? 'Agendando…' : 'Confirmar agendamento'}
          </button>
        </div>
      </form>
    </div>
  );
}
