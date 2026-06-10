import { describe, it, expect } from 'vitest';
import { professionalsService } from './professionals';

describe('professionalsService', () => {
  it('expõe os métodos CRUD esperados', () => {
    expect(typeof professionalsService.getAll).toBe('function');
    expect(typeof professionalsService.getActive).toBe('function');
    expect(typeof professionalsService.create).toBe('function');
    expect(typeof professionalsService.update).toBe('function');
    expect(typeof professionalsService.delete).toBe('function');
  });

  it('getAll sem Supabase configurado retorna erro sem lançar', async () => {
    const res = await professionalsService.getAll(null);
    expect(res).toHaveProperty('data');
    expect(res).toHaveProperty('error');
    expect(Array.isArray(res.data)).toBe(true);
  });
});
