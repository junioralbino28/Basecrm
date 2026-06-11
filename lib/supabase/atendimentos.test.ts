import { describe, it, expect } from 'vitest';
import { __transformAtendimento, __atendimentoToInsert } from './atendimentos';

describe('atendimentos transform', () => {
  it('transforma linha do DB (snake) para app (camel)', () => {
    const app = __transformAtendimento({
      id: 'a1',
      organization_id: 'org1',
      contact_id: 'c1',
      deal_id: 'd1',
      professional_id: 'p1',
      product_id: 'prod1',
      procedimento: 'Limpeza',
      valor: 250,
      desconto: 30,
      payment_method: 'pix',
      card_brand: null,
      installments: 1,
      recebido: true,
      paid_at: '2026-06-09T12:00:00.000Z',
      performed_at: '2026-06-09T12:00:00.000Z',
      owner_id: 'u1',
      created_at: '2026-06-09T12:00:00.000Z',
      updated_at: '2026-06-09T12:00:00.000Z',
    });
    expect(app.organizationId).toBe('org1');
    expect(app.procedimento).toBe('Limpeza');
    expect(app.valor).toBe(250);
    expect(app.desconto).toBe(30);
    expect(app.recebido).toBe(true);
    expect(app.paymentMethod).toBe('pix');
    expect(app.cardBrand).toBeUndefined();
    expect(app.installments).toBe(1);
  });

  it('insert seta paid_at=now() quando recebido=true e null quando false', () => {
    const recebido = __atendimentoToInsert(
      {
        procedimento: 'Canal',
        valor: 800,
        desconto: 0,
        recebido: true,
        installments: 1,
        performedAt: '2026-06-09T12:00:00.000Z',
      },
      'org1',
      'u1'
    );
    expect(recebido.organization_id).toBe(null); // 'org1' não é UUID válido → sanitizado
    expect(recebido.recebido).toBe(true);
    expect(typeof recebido.paid_at).toBe('string');

    const naoRecebido = __atendimentoToInsert(
      {
        procedimento: 'Canal',
        valor: 800,
        desconto: 0,
        recebido: false,
        installments: 1,
        performedAt: '2026-06-09T12:00:00.000Z',
      },
      'org1',
      'u1'
    );
    expect(naoRecebido.recebido).toBe(false);
    expect(naoRecebido.paid_at).toBeNull();
  });

  it('insert carimba org/owner (UUID válido) e propaga desconto', () => {
    const orgId = '11111111-1111-4111-8111-111111111111';
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const row = __atendimentoToInsert(
      {
        procedimento: 'Restauração',
        valor: 350,
        desconto: 30,
        recebido: true,
        installments: 3,
        paymentMethod: 'credito',
        cardBrand: 'visa',
        performedAt: '2026-06-10T12:00:00.000Z',
      },
      orgId,
      ownerId
    );
    expect(row.organization_id).toBe(orgId);
    expect(row.owner_id).toBe(ownerId);
    expect(row.desconto).toBe(30);
    expect(row.card_brand).toBe('visa');
    expect(row.installments).toBe(3);
    expect(row.performed_at).toBe('2026-06-10T12:00:00.000Z');
  });

  it('HIGH-2: normaliza a bandeira (lower+trim) no insert pra casar com a config de taxas', () => {
    const orgId = '11111111-1111-4111-8111-111111111111';
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const row = __atendimentoToInsert(
      {
        procedimento: 'Faceta',
        valor: 1000,
        desconto: 0,
        recebido: true,
        installments: 1,
        paymentMethod: 'credito',
        cardBrand: '  Visa ',
        performedAt: '2026-06-10T12:00:00.000Z',
      },
      orgId,
      ownerId
    );
    // 'Visa ' free-text → 'visa' (mesma chave que payment_method_fees grava).
    expect(row.card_brand).toBe('visa');
  });
});
