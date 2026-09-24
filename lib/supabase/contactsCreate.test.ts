/**
 * Trava a mesma armadilha que produziu o "histórico invisível" das atividades, agora em
 * `contacts` (medido no schema de produção em 24/09/2026: `organization_id` aceita NULL e
 * não tem default).
 *
 * A RLS de `contacts` é `can_access_organization(organization_id)` para ler, e essa função
 * devolve NULL quando o campo é nulo — em RLS, NULL significa NEGAR. Um contato criado sem
 * organização nasce invisível para todo mundo, inclusive para quem acabou de criá-lo.
 *
 * Em produção isso ainda não tinha doído porque os 10 contatos existentes vieram TODOS do
 * webhook da Evolution, que passa a organização explicitamente. Quem não passava era o
 * insert da TELA — e o comentário em `useCreateContact` afirmava, errado, que um gatilho
 * preencheria o campo.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const single = vi.fn();
const select = vi.fn(() => ({ single }));
const insert = vi.fn(() => ({ select }));
const from = vi.fn(() => ({ insert }));

vi.mock('./client', () => ({
  supabase: { from: (...args: unknown[]) => from(...(args as [])) },
}));

import { contactsService } from './contacts';

const ORG = '11111111-1111-4111-8111-111111111111';

const contato = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'Púlpitos Gênesis',
    email: '',
    phone: '+5521970484359',
    role: '',
    avatar: '',
    notes: '',
    status: 'ACTIVE',
    stage: 'LEAD',
    totalValue: 0,
    ...extra,
  }) as any;

describe('contactsService.create — organização obrigatória', () => {
  beforeEach(() => {
    from.mockClear();
    insert.mockClear();
    select.mockClear();
    single.mockClear();
    single.mockResolvedValue({
      data: {
        id: 'c1',
        organization_id: ORG,
        name: 'Púlpitos Gênesis',
        email: null,
        phone: '+5521970484359',
        role: null,
        client_company_id: null,
        avatar: null,
        notes: null,
        status: 'ACTIVE',
        stage: 'LEAD',
        source: null,
        contact_preference: null,
        birth_date: null,
        last_interaction: null,
        last_purchase_date: null,
        total_value: 0,
        created_at: '2026-09-24T12:00:00.000Z',
        updated_at: '2026-09-24T12:00:00.000Z',
      },
      error: null,
    });
  });

  it('recusa e NÃO grava quando o contato vem sem organização', async () => {
    const { data, error } = await contactsService.create(contato());

    expect(data).toBeNull();
    expect(error?.message).toMatch(/organiza/i);
    // O ponto do teste: nada chega ao banco. Gravar sem a organização é pior que falhar,
    // porque o contato nasce invisível e nenhum erro aparece na tela.
    expect(insert).not.toHaveBeenCalled();
  });

  it('recusa quando a organização não é um UUID válido', async () => {
    const { data, error } = await contactsService.create(
      contato({ organizationId: 'organizacao-do-cliente' }),
    );

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
  });

  it('grava organization_id no insert quando a organização vem preenchida', async () => {
    const { data, error } = await contactsService.create(contato({ organizationId: ORG }));

    expect(error).toBeNull();
    expect(data?.organizationId).toBe(ORG);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      organization_id: ORG,
      name: 'Púlpitos Gênesis',
    });
  });
});

describe('quem pode criar contato', () => {
  const RAIZ = path.resolve(__dirname, '..', '..');
  // Os únicos pontos que podem chamar `contactsService.create` no cliente. Cada um injeta a
  // organização a partir da fonte que já tem em mãos (o cliente aberto ou o perfil). Uma tela
  // chamando direto voltaria a criar contato órfão sem ninguém perceber.
  const PERMITIDOS = [
    path.join('context', 'contacts', 'ContactsContext.tsx'),
    path.join('lib', 'query', 'hooks', 'useContactsQuery.ts'),
    // A agenda cria o contato na hora quando a marcação é para alguém de fora da lista
    // (24/09/2026). Injeta a organização do cliente aberto — ver `criarMutation`.
    path.join('features', 'agenda', 'hooks', 'useAgendaLocalController.ts'),
  ];
  const IGNORAR = new Set([
    'node_modules', '.next', '.git', 'dist', 'coverage', 'playwright-report', 'test-results',
  ]);

  const varrer = (dir: string, achados: string[] = []): string[] => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORAR.has(entrada.name)) continue;
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(completo, achados);
      else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.test\.(ts|tsx)$/.test(entrada.name)) {
        // O próprio `contacts.ts` cita a chamada num exemplo de JSDoc — não é chamador.
        if (path.relative(RAIZ, completo) === path.join('lib', 'supabase', 'contacts.ts')) continue;
        if (fs.readFileSync(completo, 'utf8').includes('contactsService.create(')) {
          achados.push(path.relative(RAIZ, completo));
        }
      }
    }
    return achados;
  };

  it('só os pontos centrais chamam contactsService.create', () => {
    const chamadores = varrer(RAIZ).sort();
    expect(
      chamadores,
      'Ponto novo criando contato: injete a organização antes de liberar '
      + '(ver lib/supabase/contacts.ts, create).',
    ).toEqual(PERMITIDOS.sort());
  });

  it('cada ponto central injeta a organização na chamada', () => {
    for (const relativo of PERMITIDOS) {
      const texto = fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
      expect(texto, `${relativo} precisa injetar a organização`).toMatch(/organizationId[,:]/);
    }
  });
});
