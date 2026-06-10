import { describe, it, expect } from 'vitest';
import type { Professional } from '@/types';

describe('Professional type', () => {
  it('aceita um profissional válido com campos camelCase', () => {
    const p: Professional = {
      id: 'a3f1c2d4-1111-4111-8111-111111111111',
      organizationId: 'b3f1c2d4-2222-4222-8222-222222222222',
      name: 'Dra. Jéssica',
      specialty: 'Ortodontia',
      active: true,
    };
    expect(p.name).toBe('Dra. Jéssica');
    expect(p.active).toBe(true);
    expect(p.specialty).toBe('Ortodontia');
  });
});
