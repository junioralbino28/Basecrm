import { describe, it, expect } from 'vitest';
import { professionalFormSchema } from './schemas';

describe('professionalFormSchema', () => {
  it('aceita profissional válido', () => {
    const r = professionalFormSchema.safeParse({
      name: 'Dra. Jéssica',
      specialty: 'Ortodontia',
      active: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const r = professionalFormSchema.safeParse({
      name: '',
      specialty: '',
      active: true,
    });
    expect(r.success).toBe(false);
  });

  it('especialidade é opcional', () => {
    const r = professionalFormSchema.safeParse({
      name: 'Dr. Adel',
      active: true,
    });
    expect(r.success).toBe(true);
  });
});
