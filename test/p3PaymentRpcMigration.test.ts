import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260803030000_p3_commission_payment_rpc.sql',
), 'utf8');

describe('Pacote 3 — pagamento de comissão seguro', () => {
  it('registra por RPC com chave de idempotência', () => {
    const migration = sql();
    expect(migration).toContain('record_commission_payment');
    expect(migration).toContain('idempotency_key uuid');
    expect(migration).toContain('ON CONFLICT (organization_id, idempotency_key)');
  });

  it('serializa pagamentos concorrentes e valida saldo', () => {
    const migration = sql();
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('v_already_paid');
    expect(migration).toContain('valor excede o saldo de remuneração');
  });

  it('autoriza no servidor e restringe o tenant', () => {
    const migration = sql();
    expect(migration).toContain("has_permission('reports.finance')");
    expect(migration).toContain('p.organization_id = p_organization_id');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.record_commission_payment[\s\S]+FROM PUBLIC, anon/i);
  });
});
