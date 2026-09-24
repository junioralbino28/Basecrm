import { describe, expect, it } from 'vitest';
import {
  buildContactProfileUpdate,
  isNomeDeContatoFraco,
  normalizeLeadName,
  resolveLeadNameUpdate,
} from './leadProfile';

/**
 * O nome que o lead DIZ na conversa (Junior, 24/09/2026: "não teria que preencher o nome do lead
 * depois que ele fala?").
 *
 * Caso real que originou isto: um lead entrou pelo anúncio com o nome de perfil do WhatsApp
 * literalmente "...", a Aurora perguntou "com quem eu falo?", ele respondeu "pedro", ela seguiu
 * tratando por Pedro — e o CRM continuou mostrando "... - WhatsApp" no card do funil, porque o
 * único nome que chegava ao contato era o do perfil.
 */

describe('normalizeLeadName — o que parece nome de pessoa', () => {
  it('aceita nome e arruma a caixa quando o lead digitou tudo minusculo', () => {
    expect(normalizeLeadName('pedro')).toBe('Pedro');
    expect(normalizeLeadName('  maria  clara ')).toBe('Maria Clara');
    expect(normalizeLeadName('joão da silva')).toBe('João Da Silva');
  });

  it('nao estraga quem ja escreveu com caixa propria', () => {
    expect(normalizeLeadName('ALAGOINHAS CONECT')).toBe('ALAGOINHAS CONECT');
    expect(normalizeLeadName('Pedro')).toBe('Pedro');
  });

  it('recusa o que nao e nome: frase, e-mail, link e simbolo', () => {
    expect(normalizeLeadName('...')).toBeNull();
    expect(normalizeLeadName('—')).toBeNull();
    expect(normalizeLeadName('pedro@empresa.com')).toBeNull();
    expect(normalizeLeadName('https://instagram.com/pedro')).toBeNull();
    expect(normalizeLeadName('meu nome e pedro e eu trabalho com relogios')).toBeNull();
    expect(normalizeLeadName('a')).toBeNull();
    expect(normalizeLeadName(null)).toBeNull();
  });
});

describe('isNomeDeContatoFraco — "ainda nao sabemos o nome"', () => {
  it.each([null, '', '   ', '...', '—', 'Lead WhatsApp 1743'])('%s e fraco', (valor) => {
    expect(isNomeDeContatoFraco(valor)).toBe(true);
  });

  it.each(['Pedro', 'ALAGOINHAS CONECT', 'Dra. Jéssica'])('%s NAO e fraco', (valor) => {
    expect(isNomeDeContatoFraco(valor)).toBe(false);
  });
});

describe('resolveLeadNameUpdate — quando o nome dito entra no contato', () => {
  it('entra quando o contato esta com um nome de perfil sem letra nenhuma', () => {
    // O caso do Pedro: perfil do WhatsApp "...", lead se apresenta na conversa.
    expect(resolveLeadNameUpdate({
      contact: { name: '...' },
      profileName: '...',
      leadName: 'pedro',
    })).toBe('Pedro');
  });

  it('entra quando o contato esta com o rotulo por telefone', () => {
    expect(resolveLeadNameUpdate({
      contact: { name: 'Lead WhatsApp 9632' },
      profileName: null,
      leadName: 'Marcos',
    })).toBe('Marcos');
  });

  it('entra quando o nome atual e exatamente o do perfil do WhatsApp (ninguem editou)', () => {
    expect(resolveLeadNameUpdate({
      contact: { name: 'Pedrinho Relogios' },
      profileName: 'Pedrinho Relogios',
      leadName: 'Pedro',
    })).toBe('Pedro');
  });

  it('NAO entra quando alguem ja corrigiu o contato a mao', () => {
    // O nome no contato nao e mais o do perfil: foi editado na tela. A IA nao desfaz isso.
    expect(resolveLeadNameUpdate({
      contact: { name: 'Pedro Von Watch (indicação do Marcos)' },
      profileName: 'Pedrinho Relogios',
      leadName: 'Pedro',
    })).toBeNull();
  });

  it('NAO entra quando o nome ja e o mesmo, mesmo com acento ou caixa diferente', () => {
    expect(resolveLeadNameUpdate({
      contact: { name: 'Púlpitos Gênesis' },
      profileName: 'Púlpitos Gênesis',
      leadName: 'pulpitos genesis',
    })).toBeNull();
  });

  it('NAO entra quando o que veio nao parece nome', () => {
    expect(resolveLeadNameUpdate({
      contact: { name: '...' },
      profileName: '...',
      leadName: 'nao quero dizer meu nome agora',
    })).toBeNull();
  });
});

describe('buildContactProfileUpdate — nome junto de e-mail e segmento', () => {
  it('leva o nome novo junto do resto', () => {
    expect(buildContactProfileUpdate({
      contact: { name: '...', email: null, notes: null },
      profileName: '...',
      leadName: 'pedro',
      leadEmail: 'pedro@relogios.com',
      leadSegment: 'Relojoaria',
    })).toEqual({
      name: 'Pedro',
      email: 'pedro@relogios.com',
      notes: 'Segmento: Relojoaria',
    });
  });

  it('sem nada novo continua devolvendo null', () => {
    expect(buildContactProfileUpdate({
      contact: { name: 'Pedro', email: 'pedro@relogios.com', notes: 'Segmento: Relojoaria' },
      profileName: 'Pedro',
      leadName: 'Pedro',
      leadEmail: 'pedro@relogios.com',
      leadSegment: 'Relojoaria',
    })).toBeNull();
  });
});
