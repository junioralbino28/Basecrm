import { describe, expect, it } from 'vitest';
import { buildContactProfileUpdate, mesmaEmpresa, normalizeLeadCompany } from './leadProfile';

/**
 * A empresa do lead (Junior, 24/09/2026: o card do funil dizia "Sem empresa" e não havia como
 * mudar em lugar nenhum).
 *
 * Dois campos DIFERENTES, e a confusão entre eles é o erro fácil:
 *  - `leadCompany` = o NOME da empresa ("Alfa Relógios") → vai para `contacts.company_name`;
 *  - `leadSegment` = o RAMO ("relojoaria") → continua indo para as notas do contato.
 */

describe('normalizeLeadCompany', () => {
  it('aceita nome de empresa e limpa o espaço sobrando', () => {
    expect(normalizeLeadCompany('  Alfa   Relógios ')).toBe('Alfa Relógios');
    expect(normalizeLeadCompany('ALAGOINHAS CONECT')).toBe('ALAGOINHAS CONECT');
  });

  it('recusa link, e-mail, símbolo solto e vazio', () => {
    expect(normalizeLeadCompany('https://instagram.com/alfa')).toBeNull();
    expect(normalizeLeadCompany('contato@alfa.com')).toBeNull();
    expect(normalizeLeadCompany('...')).toBeNull();
    expect(normalizeLeadCompany('')).toBeNull();
    expect(normalizeLeadCompany(null)).toBeNull();
  });
});

describe('mesmaEmpresa — casa nome ignorando acento, caixa e espaço', () => {
  it('reconhece a mesma empresa escrita de jeitos diferentes', () => {
    expect(mesmaEmpresa('Alfa Relógios', 'alfa relogios')).toBe(true);
    expect(mesmaEmpresa('  ALFA   RELOGIOS ', 'Alfa Relogios')).toBe(true);
  });

  it('não confunde empresas diferentes', () => {
    expect(mesmaEmpresa('Alfa Relógios', 'Alfa Relojoaria')).toBe(false);
    expect(mesmaEmpresa('Alfa', 'Beta')).toBe(false);
  });
});

describe('buildContactProfileUpdate — empresa', () => {
  it('grava o nome da empresa quando o contato ainda não tem', () => {
    expect(buildContactProfileUpdate({
      contact: { name: 'Pedro', email: 'p@alfa.com', notes: 'Segmento: Relojoaria', company_name: null },
      profileName: 'Pedro',
      leadCompany: 'Alfa Relógios',
    })).toEqual({ company_name: 'Alfa Relógios' });
  });

  it('NÃO troca a empresa que o contato já tem — quem corrige empresa é gente', () => {
    expect(buildContactProfileUpdate({
      contact: { name: 'Pedro', email: null, notes: null, company_name: 'Alfa Relógios LTDA' },
      profileName: 'Pedro',
      leadCompany: 'Alfa',
    })).toBeNull();
  });

  it('empresa e ramo sao coisas separadas e convivem', () => {
    expect(buildContactProfileUpdate({
      contact: { name: 'Pedro', email: null, notes: null, company_name: null },
      profileName: 'Pedro',
      leadCompany: 'Alfa Relógios',
      leadSegment: 'Relojoaria',
    })).toEqual({
      company_name: 'Alfa Relógios',
      notes: 'Segmento: Relojoaria',
    });
  });
});
