import { describe, it, expect } from 'vitest';
import type { Contact, LeadSource } from '@/types';

describe('LeadSource type (N1 — origens editáveis)', () => {
  it('aceita uma origem válida com campos camelCase', () => {
    const s: LeadSource = {
      id: 'a3f1c2d4-1111-4111-8111-111111111111',
      organizationId: 'b3f1c2d4-2222-4222-8222-222222222222',
      name: 'Anúncio Meta',
      active: true,
    };
    expect(s.name).toBe('Anúncio Meta');
    expect(s.active).toBe(true);
  });

  it('Contact.source aceita nome livre de origem (alimentado por lead_sources)', () => {
    const c: Pick<Contact, 'source'> = { source: 'Google/GMN' };
    expect(c.source).toBe('Google/GMN');
  });
});
