import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

type FormState = {
  companyName: string;
  subdomain: string;
  specialty: string;
  primaryGoal: string;
  serviceModel: string;
  leadChannel: string;
  notes: string;
};

interface TenantProvisioningWizardProps {
  form: FormState;
  onChange: (field: keyof FormState, value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  error: string | null;
}

const FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 dark:border-white/10 dark:bg-slate-950 dark:text-white';

export const TenantProvisioningWizard: React.FC<TenantProvisioningWizardProps> = ({
  form,
  onChange,
  onSubmit,
  isSubmitting,
  error,
}) => {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Nova Clinica</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Briefing minimo para criar a organization e gerar o board inicial da entrega.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nome da clinica</span>
            <input className={FIELD_CLASS} value={form.companyName} onChange={(e) => onChange('companyName', e.target.value)} />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Subdominio sugerido</span>
            <input className={FIELD_CLASS} value={form.subdomain} onChange={(e) => onChange('subdomain', e.target.value)} />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Especialidade</span>
            <input className={FIELD_CLASS} value={form.specialty} onChange={(e) => onChange('specialty', e.target.value)} placeholder="Odonto, estetica, nutricao..." />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Objetivo principal</span>
            <input className={FIELD_CLASS} value={form.primaryGoal} onChange={(e) => onChange('primaryGoal', e.target.value)} placeholder="Agendar avaliacao, vender procedimento..." />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Modelo de atendimento</span>
            <input className={FIELD_CLASS} value={form.serviceModel} onChange={(e) => onChange('serviceModel', e.target.value)} placeholder="Consulta, avaliacao, retorno..." />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Canal principal de leads</span>
            <input className={FIELD_CLASS} value={form.leadChannel} onChange={(e) => onChange('leadChannel', e.target.value)} placeholder="WhatsApp, Instagram, trafego pago..." />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Observacoes</span>
            <textarea
              className={`${FIELD_CLASS} min-h-32 resize-y`}
              value={form.notes}
              onChange={(e) => onChange('notes', e.target.value)}
              placeholder="Detalhes do processo comercial, equipe, restricoes operacionais..."
            />
          </label>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Provisionar clinica
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm dark:border-white/10 dark:bg-slate-950">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">O que esta entrega faz agora</div>
        <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <li>Cria a `organization` do tenant.</li>
          <li>Registra a edition `clinic` com branding base e modulos iniciais.</li>
          <li>Abre um `provisioning_run` auditavel.</li>
          <li>Gera o board inicial usando a IA do operador atual, com fallback seguro.</li>
          <li>Persiste o board e suas stages no tenant novo.</li>
        </ul>
      </div>
    </div>
  );
};
