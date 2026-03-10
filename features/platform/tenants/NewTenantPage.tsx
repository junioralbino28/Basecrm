import React from 'react';
import { useRouter } from 'next/navigation';
import { TenantProvisioningWizard } from './components/TenantProvisioningWizard';

type FormState = {
  companyName: string;
  subdomain: string;
  specialty: string;
  primaryGoal: string;
  serviceModel: string;
  leadChannel: string;
  notes: string;
};

const INITIAL_FORM: FormState = {
  companyName: '',
  subdomain: '',
  specialty: 'Odontologia',
  primaryGoal: '',
  serviceModel: '',
  leadChannel: 'WhatsApp',
  notes: '',
};

export const NewTenantPage: React.FC = () => {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleChange = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/platform/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao preparar clinica (HTTP ${res.status})`);

      router.push('/platform/tenants');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao preparar clinica.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-8 max-w-7xl mx-auto">
      <TenantProvisioningWizard
        form={form}
        onChange={handleChange}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        error={error}
      />
    </div>
  );
};
