// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getSupabaseAdminClient, requireSupabaseData } from './helpers/supabaseAdmin';
import { getSupabaseUrl } from './helpers/env';
import { filtroDoCursor, lerCursorDeClientes, type CursorDeClientes } from '@/lib/platform/cursorDeClientes';

/**
 * Central de Agentes, bloco 2 (revisão do Codex no código, rodada 2, achado 3): o cursor da lista de clientes contra o
 * PostgREST de verdade. O teste da rota só prova o texto do filtro; este prova que o PostgREST o aceita (instante entre
 * aspas, microssegundos, fuso) e que andar página a página visita cada cliente uma vez, inclusive os criados no mesmo
 * instante. O created_at que volta do banco também tem de passar pela validação do cursor.
 */
const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

describeLocal('cursor da lista de clientes — Supabase local', () => {
  const prefixo = `paginacao-${randomUUID()}`;

  afterAll(async () => {
    const db = getSupabaseAdminClient();
    await db.from('organizations').delete().like('name', `${prefixo}%`);
    const sobra = await db.from('organizations').select('id', { count: 'exact', head: true }).like('name', `${prefixo}%`);
    expect(sobra.count).toBe(0);
  });

  it('páginas de 2 visitam os 5 clientes uma vez cada, na ordem da lista inteira, com 3 empatados no instante', async () => {
    const db = getSupabaseAdminClient();
    const empate = '2020-01-02T03:04:05.123456+00:00';
    const linhas = [
      { name: `${prefixo}-depois`, created_at: '2020-01-02T03:04:06.000001+00:00' },
      { name: `${prefixo}-a`, created_at: empate },
      { name: `${prefixo}-b`, created_at: empate },
      { name: `${prefixo}-c`, created_at: empate },
      { name: `${prefixo}-antes`, created_at: '2020-01-02T03:04:04+00:00' },
    ];
    requireSupabaseData(await db.from('organizations').insert(linhas).select('id'), 'insert organizations');

    const consulta = () => db.from('organizations').select('id, created_at').is('deleted_at', null).like('name', `${prefixo}%`);
    const inteira = requireSupabaseData(
      await consulta().order('created_at', { ascending: false }).order('id', { ascending: false }),
      'lista inteira',
    ) as Array<{ id: string; created_at: string }>;
    expect(inteira).toHaveLength(5);

    const visitados: string[] = [];
    let cursor: CursorDeClientes | null = null;
    for (let volta = 0; volta < 10; volta += 1) {
      let q = consulta();
      if (cursor) q = q.or(filtroDoCursor(cursor));
      const pagina = requireSupabaseData(
        await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(2),
        `pagina ${volta}`,
      ) as Array<{ id: string; created_at: string }>;
      visitados.push(...pagina.map((l) => l.id));
      if (pagina.length < 2) break;
      const ultimo = pagina[pagina.length - 1];
      // O mesmo caminho da tela: o valor vai pela URL e volta pela validação da rota.
      const lido = lerCursorDeClientes(new URLSearchParams({ antesDe: ultimo.created_at, antesDeId: ultimo.id }));
      expect(lido, `cursor recusado: ${ultimo.created_at}`).not.toBe('invalido');
      cursor = lido as CursorDeClientes;
    }
    expect(visitados).toEqual(inteira.map((l) => l.id));
  });
});
