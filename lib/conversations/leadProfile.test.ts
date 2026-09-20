import { describe, expect, it } from 'vitest';
import { buildContactProfileUpdate, normalizeLeadEmail, normalizeLeadSegment } from './leadProfile';

describe('dados do lead coletados antes da reuniao', () => {
  it('normaliza e-mail e segmento e descarta lixo', () => {
    expect(normalizeLeadEmail('  Junior@Empresa.com.br ')).toBe('junior@empresa.com.br');
    expect(normalizeLeadEmail('nao tenho')).toBeNull();
    expect(normalizeLeadEmail(null)).toBeNull();
    expect(normalizeLeadSegment('  clinica   de estetica ')).toBe('clinica de estetica');
    expect(normalizeLeadSegment('x')).toBeNull();
  });

  it('grava e-mail so quando o contato nao tem, e o segmento uma unica vez nas notas', () => {
    expect(buildContactProfileUpdate({
      contact: { email: null, notes: null },
      leadEmail: 'lead@empresa.com',
      leadSegment: 'Imobiliaria',
    })).toEqual({ email: 'lead@empresa.com', notes: 'Segmento: Imobiliaria' });

    expect(buildContactProfileUpdate({
      contact: { email: 'ja@tem.com', notes: 'Cliente antigo\nSegmento: Imobiliaria' },
      leadEmail: 'outro@empresa.com',
      leadSegment: 'Imobiliaria',
    })).toBeNull();

    expect(buildContactProfileUpdate({
      contact: { email: '', notes: 'Veio do anuncio' },
      leadEmail: null,
      leadSegment: 'SaaS B2B',
    })).toEqual({ notes: 'Veio do anuncio\nSegmento: SaaS B2B' });
  });
});
