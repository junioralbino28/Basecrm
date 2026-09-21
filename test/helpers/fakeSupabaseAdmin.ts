/**
 * Cliente admin do Supabase falso, com tabelas em memória, para testar rotas inteiras (SPEC-midia-recebida v2, Passo 0).
 *
 * Imita só o que as rotas de conversa usam: select / eq / lt / in / is / order / limit / maybeSingle / single /
 * insert / update / upsert / delete e rpc. Como o supabase-js, `update` ignora chave `undefined`. Tem a mesma trava de
 * unicidade do banco em `conversation_messages (channel_connection_id, provider_message_id)`, porque a rota
 * depende do erro 23505 para tratar reentrega de webhook.
 */
type Row = Record<string, unknown>;
type Result = { data: Row[]; error: { message: string; code?: string } | null };

export type FakeSupabaseAdmin = ReturnType<typeof createFakeSupabaseAdmin>;

export function createFakeSupabaseAdmin(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));

  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpcErrors: Record<string, string> = {};
  let sequence = 0;

  const rowsOf = (table: string) => (tables[table] ??= []);

  /** Aceita caminho JSON do PostgREST (`metadata->media->>status`). */
  const readColumn = (row: Row, column: string) => {
    if (!column.includes('->')) return row[column];
    let current: unknown = row;
    for (const part of column.split(/->>?/)) {
      if (!current || typeof current !== 'object') return undefined;
      current = (current as Row)[part];
    }
    return current;
  };

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const orders: Array<{ column: string; ascending: boolean }> = [];
    let operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: Row | null = null;
    let limitCount: number | null = null;
    let conflictColumn = 'id';

    function run(): Promise<Result> {
      if (operation === 'upsert' && payload) {
        const value = payload;
        const existing = rowsOf(table).find((row) => row[conflictColumn] === value[conflictColumn]);
        if (existing) {
          Object.assign(existing, value);
          return Promise.resolve({ data: [existing], error: null });
        }
        const row: Row = { id: value.id ?? `fake-${table}-${++sequence}`, ...value };
        rowsOf(table).push(row);
        return Promise.resolve({ data: [row], error: null });
      }

      if (operation === 'insert' && payload) {
        const row: Row = { id: payload.id ?? `fake-${table}-${++sequence}`, ...payload };
        if (table === 'conversation_messages' && row.provider_message_id) {
          const clash = rowsOf(table).some(
            (existing) =>
              existing.channel_connection_id === row.channel_connection_id &&
              existing.provider_message_id === row.provider_message_id,
          );
          if (clash) return Promise.resolve({ data: [], error: { message: 'duplicate key value', code: '23505' } });
        }
        rowsOf(table).push(row);
        return Promise.resolve({ data: [row], error: null });
      }

      const matched = rowsOf(table).filter((row) => filters.every((test) => test(row)));

      if (operation === 'delete') {
        tables[table] = rowsOf(table).filter((row) => !matched.includes(row));
        return Promise.resolve({ data: matched, error: null });
      }

      if (operation === 'update' && payload) {
        for (const row of matched) {
          for (const [key, value] of Object.entries(payload)) {
            if (value !== undefined) row[key] = value;
          }
        }
        return Promise.resolve({ data: matched, error: null });
      }

      let selected = matched.slice();
      for (const { column, ascending } of orders.slice().reverse()) {
        selected = selected.sort((a, b) => {
          const left = a[column] as string | number | null | undefined;
          const right = b[column] as string | number | null | undefined;
          if (left === right) return 0;
          if (left === null || left === undefined) return 1;
          if (right === null || right === undefined) return -1;
          return (left < right ? -1 : 1) * (ascending ? 1 : -1);
        });
      }
      if (limitCount !== null) selected = selected.slice(0, limitCount);
      return Promise.resolve({ data: selected, error: null });
    }

    const builder = {
      select: () => builder,
      insert: (value: Row) => {
        operation = 'insert';
        payload = value;
        return builder;
      },
      update: (value: Row) => {
        operation = 'update';
        payload = value;
        return builder;
      },
      delete: () => {
        operation = 'delete';
        return builder;
      },
      upsert: (value: Row, options?: { onConflict?: string }) => {
        operation = 'upsert';
        payload = value;
        conflictColumn = options?.onConflict ?? 'id';
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => readColumn(row, column) === value);
        return builder;
      },
      lt: (column: string, value: string | number) => {
        filters.push((row) => {
          const current = readColumn(row, column) as string | number | null | undefined;
          return current !== null && current !== undefined && current < value;
        });
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        orders.push({ column, ascending: options?.ascending !== false });
        return builder;
      },
      limit: (count: number) => {
        limitCount = count;
        return builder;
      },
      maybeSingle: () => run().then((result) => ({ data: result.data[0] ?? null, error: result.error })),
      single: () =>
        run().then((result) =>
          result.error
            ? { data: null, error: result.error }
            : result.data[0]
              ? { data: result.data[0], error: null }
              : { data: null, error: { message: 'no rows returned', code: 'PGRST116' } },
        ),
      then: <T>(resolve: (value: Result) => T, reject?: (reason: unknown) => T) => run().then(resolve, reject),
    };

    return builder;
  }

  function rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ name, args });
    const message = rpcErrors[name];
    return Promise.resolve(message ? { data: null, error: { message } } : { data: null, error: null });
  }

  return { from, rpc, tables, rowsOf, rpcCalls, rpcErrors };
}
