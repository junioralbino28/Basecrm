import { describe, expect, it } from 'vitest';
import {
  DURACAO_PADRAO_REUNIAO_MIN,
  PREFIXO_REUNIAO_IA,
  mapearReuniaoDaIA,
} from '@/lib/supabase/agendaReunioes';
import { COLUNA_PADRAO_ID, colunaDoCompromisso } from './components/agendaFormato';

/**
 * A reuniao que a IA marca vive em `activities` (+ Google), nao em `appointments`.
 * Ate 22/09/2026 a agenda do menu nao a lia, e a tela ficava vazia mesmo com reuniao
 * marcada. Estes testes travam a traducao de uma coisa para a outra.
 */
function atividade(extra: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: '22222222-2222-4222-8222-222222222222',
    title: 'Diagnóstico Cenoura Hub — Marina',
    description: 'Conversa de 40 minutos.',
    date: '2026-09-24T17:00:00.000Z',
    completed: false,
    contact_id: '33333333-3333-4333-8333-333333333333',
    owner_id: '44444444-4444-4444-8444-444444444444',
    contacts: { name: 'Marina Souza', phone: '+5521999112160' },
    ...extra,
  };
}

describe('reuniao da IA dentro da agenda do CRM', () => {
  it('o id leva prefixo proprio — nunca colide com um compromisso de verdade', () => {
    const reuniao = mapearReuniaoDaIA(atividade() as never);
    expect(reuniao.id).toBe(`${PREFIXO_REUNIAO_IA}11111111-1111-4111-8111-111111111111`);
  });

  it('ocupa a duracao padrao da reuniao, e nao uma linha solta da grade', () => {
    const reuniao = mapearReuniaoDaIA(atividade() as never);
    const minutos = (new Date(reuniao.endsAt!).getTime() - new Date(reuniao.startsAt).getTime()) / 60_000;
    expect(minutos).toBe(DURACAO_PADRAO_REUNIAO_MIN);
  });

  it('nasce SOMENTE LEITURA: remarcar e cancelar sao pela conversa, que avisa o lead e o Google', () => {
    expect(mapearReuniaoDaIA(atividade() as never).somenteLeitura).toBe(true);
    expect(mapearReuniaoDaIA(atividade() as never).source).toBe('aurora');
  });

  it('nao tem profissional: e do responsavel da conexao, nao de alguem da equipe cadastrada', () => {
    expect(mapearReuniaoDaIA(atividade() as never).professionalId).toBeUndefined();
  });

  it('marcada como feita aparece como "compareceu"; em aberto, como "agendado"', () => {
    expect(mapearReuniaoDaIA(atividade({ completed: true }) as never).status).toBe('compareceu');
    expect(mapearReuniaoDaIA(atividade() as never).status).toBe('agendado');
  });

  it('leva o nome do contato para a tela e guarda o titulo da reuniao', () => {
    const reuniao = mapearReuniaoDaIA(atividade() as never);
    expect(reuniao.contactName).toBe('Marina Souza');
    expect(reuniao.titulo).toBe('Diagnóstico Cenoura Hub — Marina');
  });

  it('sem contato ligado, ainda aparece — com o titulo no lugar do nome', () => {
    const reuniao = mapearReuniaoDaIA(atividade({ contacts: null, contact_id: null }) as never);
    expect(reuniao.contactName).toBeNull();
    expect(reuniao.titulo).toBe('Diagnóstico Cenoura Hub — Marina');
  });
});

describe('em qual coluna cada compromisso aparece', () => {
  const COLUNA_PADRAO = [{ id: COLUNA_PADRAO_ID }];
  const EQUIPE = [{ id: 'pro-a' }, { id: 'pro-b' }];

  it('sem profissional, cai na coluna padrao quando ela existe', () => {
    expect(colunaDoCompromisso({}, COLUNA_PADRAO)).toBe(COLUNA_PADRAO_ID);
  });

  it('sem profissional e COM equipe cadastrada, fica de fora (nao inventa coluna)', () => {
    expect(colunaDoCompromisso({}, EQUIPE)).toBeNull();
  });

  it('com profissional que esta na tela, vai na coluna dele', () => {
    expect(colunaDoCompromisso({ professionalId: 'pro-b' }, EQUIPE)).toBe('pro-b');
  });

  it('profissional que NAO esta na tela (filtro por pessoa) nao vaza para a coluna de outro', () => {
    expect(colunaDoCompromisso({ professionalId: 'pro-z' }, EQUIPE)).toBeNull();
  });
});
