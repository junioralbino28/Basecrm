import { describe, expect, it } from 'vitest';
import { leadSourceFormSchema } from '@/lib/validations/schemas';

describe('leadSourceFormSchema (N1 — origens editáveis)', () => {
  it('aceita origem válida', () => {
    const res = leadSourceFormSchema.safeParse({ name: 'Anúncio Meta', active: true });
    expect(res.success).toBe(true);
  });

  it('aplica active=true por default', () => {
    const res = leadSourceFormSchema.safeParse({ name: 'Indicação' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.active).toBe(true);
  });

  it('rejeita nome vazio', () => {
    expect(leadSourceFormSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejeita nome acima de 100 caracteres', () => {
    expect(leadSourceFormSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });
});
