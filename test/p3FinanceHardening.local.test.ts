// @vitest-environment node

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupFixtures, createMinimalFixtures } from './helpers/fixtures';
import {
  assertNoSupabaseError,
  getSupabaseAdminClient,
  requireSupabaseData,
} from './helpers/supabaseAdmin';
import { createE2UserClient, loadE2SupabaseConfig } from './helpers/e2Supabase';

const config = loadE2SupabaseConfig();
const describeLocal = config ? describe : describe.skip;

type CommissionPaymentRow = {
  id: string;
  organization_id: string;
  professional_id: string;
  amount: number | string;
  paid_at: string;
  period: string;
  idempotency_key: string;
};

const PERIOD = '2026-06';
const PERFORMED_AT = '2026-06-15T10:00:00-03:00';

describeLocal('P3 finance hardening - Supabase local real', () => {
  const admin = config ? getSupabaseAdminClient() : null;
  const unique = randomUUID();
  const password = `P3!${unique}aA1`;

  let fixtureRunId = '';
  let organizationA = '';
  let organizationB = '';
  let professionalA = '';
  let professionalB = '';
  let fixedProfessional = '';
  let initialSpecialtyId = '';
  let nextSpecialtyId = '';
  let atendimentoId = '';
  let fixedAtendimentoId = '';
  let adminUserId = '';
  let clientA: SupabaseClient | null = null;

  function requireClient(): SupabaseClient {
    if (!clientA) throw new Error('Cliente autenticado da organização A não inicializado');
    return clientA;
  }

  function requirePayment(
    result: { data: unknown; error: { message?: string } | null },
    context: string,
  ): CommissionPaymentRow {
    expect(result.error, `${context}: ${result.error?.message ?? ''}`).toBeNull();
    expect(result.data, context).not.toBeNull();
    return result.data as CommissionPaymentRow;
  }

  beforeAll(async () => {
    if (!admin || !config) return;

    const fixtures = await createMinimalFixtures();
    fixtureRunId = fixtures.runId;
    organizationA = fixtures.orgA.organizationId;
    organizationB = fixtures.orgB.organizationId;

    const specialtyNames = {
      initial: `P3 Inicial ${unique}`,
      next: `P3 Nova ${unique}`,
    };
    const specialties = await admin
      .from('specialties')
      .insert([
        { organization_id: organizationA, name: specialtyNames.initial },
        { organization_id: organizationA, name: specialtyNames.next },
      ])
      .select('id, name');
    const specialtyRows = requireSupabaseData(specialties, 'insert specialties P3');
    initialSpecialtyId = specialtyRows.find((row) => row.name === specialtyNames.initial)?.id ?? '';
    nextSpecialtyId = specialtyRows.find((row) => row.name === specialtyNames.next)?.id ?? '';
    if (!initialSpecialtyId || !nextSpecialtyId) {
      throw new Error('Fixture P3 não retornou as duas especialidades');
    }

    const professionals = await admin
      .from('professionals')
      .insert([
        {
          organization_id: organizationA,
          name: `Profissional A ${unique}`,
          specialty: specialtyNames.initial,
          pay_type: 'commission',
          fixed_amount: 0,
          active: true,
        },
        {
          organization_id: organizationB,
          name: `Profissional B ${unique}`,
          pay_type: 'commission',
          fixed_amount: 0,
          active: true,
        },
      ])
      .select('id, organization_id');
    const professionalRows = requireSupabaseData(professionals, 'insert professionals P3');
    professionalA =
      professionalRows.find((row) => row.organization_id === organizationA)?.id ?? '';
    professionalB =
      professionalRows.find((row) => row.organization_id === organizationB)?.id ?? '';
    if (!professionalA || !professionalB) {
      throw new Error('Fixture P3 não retornou os dois profissionais');
    }

    assertNoSupabaseError(
      await admin.from('professional_specialties').insert({
        organization_id: organizationA,
        professional_id: professionalA,
        specialty_id: initialSpecialtyId,
      }),
      'link initial specialty P3',
    );

    // A regra histórica é criada uma vez e nunca será reescrita neste teste.
    assertNoSupabaseError(
      await admin.from('commission_rules').insert({
        organization_id: organizationA,
        professional_id: professionalA,
        specialty_id: initialSpecialtyId,
        amount_type: 'percent',
        amount: 20,
        percent: 20,
        valid_from: '2020-01-01',
      }),
      'insert historical commission rule P3',
    );

    const atendimento = await admin
      .from('atendimentos')
      .insert({
        organization_id: organizationA,
        professional_id: professionalA,
        procedimento: `Serviço P3 ${unique}`,
        valor: 1000,
        desconto: 0,
        installments: 1,
        recebido: false,
        paid_at: null,
        performed_at: PERFORMED_AT,
      })
      .select('id, commission_amount')
      .single();
    const atendimentoRow = requireSupabaseData(atendimento, 'insert atendimento P3');
    atendimentoId = atendimentoRow.id;
    if (Number(atendimentoRow.commission_amount) !== 200) {
      throw new Error(
        `Fixture P3 esperava snapshot 200, recebeu ${atendimentoRow.commission_amount}`,
      );
    }

    const fixedProfessionalResult = await admin
      .from('professionals')
      .insert({
        organization_id: organizationA,
        name: `Profissional Fixo ${unique}`,
        pay_type: 'fixed',
        fixed_amount: 1000,
        active: true,
      })
      .select('id')
      .single();
    fixedProfessional = requireSupabaseData(
      fixedProfessionalResult,
      'insert fixed-only professional P3',
    ).id;

    assertNoSupabaseError(
      await admin.from('professional_compensation_versions').insert([
        {
          organization_id: organizationA,
          professional_id: fixedProfessional,
          pay_type: 'fixed',
          fixed_amount: 1000,
          active: true,
          valid_from: '2020-01-01',
        },
        {
          organization_id: organizationA,
          professional_id: fixedProfessional,
          pay_type: 'fixed',
          fixed_amount: 2000,
          active: true,
          valid_from: '2026-06-16',
        },
      ]),
      'insert fixed-only compensation version P3',
    );
    assertNoSupabaseError(
      await admin.from('commission_rules').insert({
        organization_id: organizationA,
        professional_id: fixedProfessional,
        amount_type: 'percent',
        amount: 20,
        percent: 20,
        valid_from: '2020-01-01',
      }),
      'insert fixed-only commission rule P3',
    );
    const fixedAtendimento = await admin
      .from('atendimentos')
      .insert({
        organization_id: organizationA,
        professional_id: fixedProfessional,
        procedimento: `Serviço fixo P3 ${unique}`,
        valor: 1000,
        desconto: 0,
        installments: 1,
        recebido: false,
        paid_at: null,
        performed_at: PERFORMED_AT,
      })
      .select('id')
      .single();
    fixedAtendimentoId = requireSupabaseData(
      fixedAtendimento,
      'insert fixed-only atendimento P3',
    ).id;

    const email = `p3.finance.${unique}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'clinic_admin', organization_id: organizationA },
    });
    if (created.error || !created.data.user?.id) {
      throw new Error(`Falha ao criar admin P3: ${created.error?.message}`);
    }
    adminUserId = created.data.user.id;

    assertNoSupabaseError(
      await admin.from('profiles').upsert(
        {
          id: adminUserId,
          email,
          name: `Admin P3 ${unique}`,
          first_name: 'Admin P3',
          role: 'clinic_admin',
          organization_id: organizationA,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      ),
      'upsert admin profile P3',
    );
    assertNoSupabaseError(
      await admin.from('profile_permissions').upsert(
        {
          user_id: adminUserId,
          organization_id: organizationA,
          permission_key: 'settings.finance',
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,permission_key' },
      ),
      'enable settings.finance P3',
    );

    clientA = createE2UserClient(config);
    const signedIn = await clientA.auth.signInWithPassword({ email, password });
    assertNoSupabaseError(signedIn, 'sign in admin P3');
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;

    if (clientA) await clientA.auth.signOut();

    const organizationIds = [organizationA, organizationB].filter(Boolean);
    if (organizationIds.length > 0) {
      for (const table of [
        'commission_payments',
        'atendimentos',
        'commission_rules',
        'professional_specialties',
        'professional_compensation_versions',
        'professionals',
        'specialties',
      ]) {
        assertNoSupabaseError(
          await admin.from(table).delete().in('organization_id', organizationIds),
          `cleanup ${table} P3`,
        );
      }
    }

    if (adminUserId) {
      assertNoSupabaseError(
        await admin.from('profile_permissions').delete().eq('user_id', adminUserId),
        'cleanup profile_permissions P3',
      );
      const deleted = await admin.auth.admin.deleteUser(adminUserId);
      assertNoSupabaseError(deleted, 'delete auth user P3');
    }

    if (fixtureRunId) await cleanupFixtures(fixtureRunId);
  }, 120_000);

  it('cria pagamento idempotente e rejeita a mesma chave com payload divergente', async () => {
    const client = requireClient();
    const idempotencyKey = randomUUID();
    const payload = {
      p_organization_id: organizationA,
      p_professional_id: professionalA,
      p_amount: 40,
      p_period: PERIOD,
      p_paid_at: '2026-06-20T09:00:00-03:00',
      p_idempotency_key: idempotencyKey,
    };

    const first = requirePayment(
      await client.rpc('record_commission_payment', payload),
      'primeiro record_commission_payment',
    );
    expect(first.organization_id).toBe(organizationA);
    expect(first.professional_id).toBe(professionalA);
    expect(Number(first.amount)).toBe(40);
    expect(first.idempotency_key).toBe(idempotencyKey);

    const retry = requirePayment(
      await client.rpc('record_commission_payment', payload),
      'retry idempotente record_commission_payment',
    );
    expect(retry.id).toBe(first.id);

    const divergent = await client.rpc('record_commission_payment', {
      ...payload,
      p_amount: 41,
    });
    expect(divergent.data).toBeNull();
    expect(divergent.error).not.toBeNull();
    expect(divergent.error?.code).toBe('23505');
    expect(divergent.error?.message).toContain('payload diferente');
  });

  it('serializa pagamentos concorrentes e impede ultrapassar o saldo', async () => {
    if (!admin) throw new Error('Admin Supabase não inicializado');
    const client = requireClient();
    const existing = await admin
      .from('commission_payments')
      .select('amount')
      .eq('organization_id', organizationA)
      .eq('professional_id', professionalA)
      .eq('period', PERIOD);
    expect(existing.error).toBeNull();

    const alreadyPaid = (existing.data ?? []).reduce(
      (total, row) => total + Number(row.amount),
      0,
    );
    const remaining = 200 - alreadyPaid;
    expect(remaining).toBeGreaterThan(0);

    const overpay = await client.rpc('record_commission_payment', {
      p_organization_id: organizationA,
      p_professional_id: professionalA,
      p_amount: remaining + 1,
      p_period: PERIOD,
      p_paid_at: '2026-06-22T09:00:00-03:00',
      p_idempotency_key: randomUUID(),
    });
    expect(overpay.data).toBeNull();
    expect(overpay.error?.code).toBe('23514');

    const keys = [randomUUID(), randomUUID()];
    const attempts = await Promise.all(keys.map((key) => client.rpc(
      'record_commission_payment',
      {
        p_organization_id: organizationA,
        p_professional_id: professionalA,
        p_amount: remaining,
        p_period: PERIOD,
        p_paid_at: '2026-06-22T09:00:00-03:00',
        p_idempotency_key: key,
      },
    )));

    const succeeded = attempts.filter((attempt) => attempt.error === null);
    const rejected = attempts.filter((attempt) => attempt.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error?.code).toBe('23514');

    const persisted = await admin
      .from('commission_payments')
      .select('id, amount, idempotency_key')
      .eq('organization_id', organizationA)
      .in('idempotency_key', keys);
    expect(persisted.error).toBeNull();
    expect(persisted.data).toHaveLength(1);
    expect(Number(persisted.data?.[0]?.amount)).toBe(remaining);

    const paymentId = persisted.data?.[0]?.id;
    if (!paymentId) throw new Error('Pagamento concorrente persistido não retornou id');
    const removed = await client.rpc('delete_commission_payment', {
      p_organization_id: organizationA,
      p_payment_id: paymentId,
    });
    expect(removed.error).toBeNull();
  });

  it('não gera comissão para colaborador somente fixo', async () => {
    if (!admin) throw new Error('Admin Supabase não inicializado');

    const snapshot = await admin
      .from('atendimentos')
      .select('commission_amount')
      .eq('id', fixedAtendimentoId)
      .single();
    expect(snapshot.error).toBeNull();
    expect(Number(snapshot.data?.commission_amount)).toBe(0);

    const report = await requireClient().rpc('get_commission_report', {
      p_start: '2026-06-01T00:00:00-03:00',
      p_end: '2026-06-30T23:59:59.999-03:00',
    });
    expect(report.error).toBeNull();
    const rows = (report.data as {
      por_profissional: Array<{
        professional_id: string;
        comissao: number;
        fixed_amount: number;
        remuneracao_total: number;
      }>;
    }).por_profissional;
    const fixedRow = rows.find((row) => row.professional_id === fixedProfessional);
    expect(fixedRow).toBeDefined();
    expect(Number(fixedRow?.comissao)).toBe(0);
    // 01–15/06: 15 × 1000/30; 16–30/06: 15 × 2000/30.
    expect(Number(fixedRow?.fixed_amount)).toBe(1500);
    expect(Number(fixedRow?.remuneracao_total)).toBe(1500);
  });

  it('nega INSERT direto autenticado em commission_payments', async () => {
    const direct = await requireClient()
      .from('commission_payments')
      .insert({
        organization_id: organizationA,
        professional_id: professionalA,
        amount: 1,
        period: PERIOD,
        paid_at: '2026-06-20T09:00:00-03:00',
        idempotency_key: randomUUID(),
      })
      .select('id')
      .single();

    expect(direct.data).toBeNull();
    expect(direct.error).not.toBeNull();
    expect(direct.error?.code).toBe('42501');
  });

  it('admin autorizado atualiza paid_at e exclui o pagamento pelas RPCs', async () => {
    const client = requireClient();
    const created = requirePayment(
      await client.rpc('record_commission_payment', {
        p_organization_id: organizationA,
        p_professional_id: professionalA,
        p_amount: 30,
        p_period: PERIOD,
        p_paid_at: '2026-06-21T09:00:00-03:00',
        p_idempotency_key: randomUUID(),
      }),
      'create payment for update/delete',
    );

    const changedPaidAt = '2026-07-05T12:30:00-03:00';
    const updated = requirePayment(
      await client.rpc('update_commission_payment_paid_at', {
        p_organization_id: organizationA,
        p_payment_id: created.id,
        p_paid_at: changedPaidAt,
      }),
      'update_commission_payment_paid_at',
    );
    expect(updated.id).toBe(created.id);
    expect(new Date(updated.paid_at).toISOString()).toBe(new Date(changedPaidAt).toISOString());

    const deleted = requirePayment(
      await client.rpc('delete_commission_payment', {
        p_organization_id: organizationA,
        p_payment_id: created.id,
      }),
      'delete_commission_payment',
    );
    expect(deleted.id).toBe(created.id);

    const absent = await client
      .from('commission_payments')
      .select('id')
      .eq('id', created.id)
      .maybeSingle();
    expect(absent.error).toBeNull();
    expect(absent.data).toBeNull();
  });

  it('mantém o snapshot da comissão após alterar o vínculo de especialidade', async () => {
    if (!admin) throw new Error('Admin Supabase não inicializado');

    const original = await admin
      .from('atendimentos')
      .select('commission_amount')
      .eq('id', atendimentoId)
      .single();
    expect(original.error).toBeNull();
    expect(Number(original.data?.commission_amount)).toBe(200);

    assertNoSupabaseError(
      await admin
        .from('professional_specialties')
        .delete()
        .eq('professional_id', professionalA)
        .eq('specialty_id', initialSpecialtyId),
      'remove initial specialty link P3',
    );
    assertNoSupabaseError(
      await admin.from('professional_specialties').insert({
        organization_id: organizationA,
        professional_id: professionalA,
        specialty_id: nextSpecialtyId,
      }),
      'insert next specialty link P3',
    );

    // A mesma resolução feita hoje já seria zero, pois o vínculo mudou.
    const recalculated = await admin.rpc('resolve_commission_amount', {
      p_organization_id: organizationA,
      p_professional_id: professionalA,
      p_product_id: null,
      p_procedure_name: `Serviço P3 ${unique}`,
      p_performed_at: PERFORMED_AT,
      p_base_amount: 1000,
    });
    expect(recalculated.error).toBeNull();
    expect(Number(recalculated.data)).toBe(0);

    // Uma atualização operacional dispara o trigger, mas não pode reabrir o snapshot.
    const operationalUpdate = await admin
      .from('atendimentos')
      .update({ recebido: true, paid_at: '2026-06-25T10:00:00-03:00' })
      .eq('id', atendimentoId)
      .select('commission_amount')
      .single();
    expect(operationalUpdate.error).toBeNull();
    expect(Number(operationalUpdate.data?.commission_amount)).toBe(200);
  });

  it('rejeita criação cross-org mesmo para admin financeiro autenticado', async () => {
    if (!admin) throw new Error('Admin Supabase não inicializado');
    const idempotencyKey = randomUUID();
    const crossOrg = await requireClient().rpc('record_commission_payment', {
      p_organization_id: organizationB,
      p_professional_id: professionalB,
      p_amount: 1,
      p_period: PERIOD,
      p_paid_at: '2026-06-20T09:00:00-03:00',
      p_idempotency_key: idempotencyKey,
    });

    expect(crossOrg.data).toBeNull();
    expect(crossOrg.error).not.toBeNull();
    expect(crossOrg.error?.code).toBe('42501');

    const persisted = await admin
      .from('commission_payments')
      .select('id')
      .eq('organization_id', organizationB)
      .eq('idempotency_key', idempotencyKey);
    expect(persisted.error).toBeNull();
    expect(persisted.data).toHaveLength(0);
  });
});
