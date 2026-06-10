import { describe, it, expect } from 'vitest';
import { leadSourcesService } from './leadSources';

describe('leadSourcesService (N1 — origens editáveis)', () => {
  it('expõe os métodos CRUD esperados', () => {
    expect(typeof leadSourcesService.getAll).toBe('function');
    expect(typeof leadSourcesService.getActive).toBe('function');
    expect(typeof leadSourcesService.create).toBe('function');
    expect(typeof leadSourcesService.update).toBe('function');
    expect(typeof leadSourcesService.delete).toBe('function');
  });

  it('getAll sem Supabase configurado retorna erro sem lançar', async () => {
    const res = await leadSourcesService.getAll(null);
    expect(res).toHaveProperty('data');
    expect(res).toHaveProperty('error');
    expect(Array.isArray(res.data)).toBe(true);
  });
});
