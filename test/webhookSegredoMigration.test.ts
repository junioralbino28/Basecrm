// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sqlComComentarios = readFileSync(
  resolve(__dirname, '../supabase/migrations/20260915000000_webhook_segredo_obrigatorio.sql'),
  'utf8',
);
// Só o código conta: o cabeçalho explica o porquê e cita "DROP" ao dizer que não há DROP.
const sql = sqlComComentarios.replace(/^\s*--.*$/gm, '');

describe('migration 20260915000000 — segredo de webhook obrigatório (parecer do Codex, B1/I7)', () => {
  it('preenche o segredo SÓ onde está vazio e nunca troca um segredo existente', () => {
    const updates = sql.match(/update\s+public\.channel_connections/gi) ?? [];
    expect(updates).toHaveLength(1);
    expect(sql).toMatch(/jsonb_build_object\('webhookSecret'/);
    expect(sql).toMatch(/where\s+nullif\(btrim\(coalesce\(config->>'webhookSecret', ''\)\), ''\)\s+is null/i);
  });

  it('gera 32 caracteres hexadecimais como o CRM (uuid sem hífen) e é aditiva', () => {
    expect(sql).toMatch(/replace\(gen_random_uuid\(\)::text, '-', ''\)/);
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});
