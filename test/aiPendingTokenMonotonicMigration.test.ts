import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = '20260921030000_conversation_thread_keep_newest_ai_pending_token.sql';
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', FILE), 'utf8').replace(/\r\n/g, '\n');

// Defeito de 21/09 (janela 4 da Aurora): gravadores que regravam a metadata inteira a partir de uma foto
// antiga devolviam o marcador da resposta ao de uma mensagem ja respondida, e a resposta da mensagem nova
// saia calada. O gatilho abaixo mantem o marcador mais novo. O comportamento foi provado no banco do
// preview; aqui fica travado o que nao pode mudar em silencio.
describe('conversa: o marcador da resposta automatica nunca volta no tempo', () => {
  it('a funcao so compara OLD e NEW: invoker, search_path vazio, sem security definer', () => {
    expect(sql).toContain(
      'create or replace function public.keep_newest_conversation_ai_pending_token()\n'
      + 'returns trigger\n'
      + 'language plpgsql\n'
      + "set search_path = ''\n",
    );
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).not.toMatch(/\b(insert into|delete from|update public\.)/i);
  });

  it('aceita a escrita quando o marcador novo tem carimbo igual ou maior; senao devolve o antigo', () => {
    expect(sql).toContain("if v_old is null or v_old !~ '^[^:]+:[0-9]{10,16}$' then\n    return new;");
    expect(sql).toContain(
      "if v_new ~ '^[^:]+:[0-9]{10,16}$'\n"
      + "     and split_part(v_new, ':', 2)::bigint >= split_part(v_old, ':', 2)::bigint then\n"
      + '    return new;',
    );
    for (const key of ['aiPendingToken', 'aiPendingSince', 'aiPendingMessageId', 'aiDebounceMs']) {
      expect(sql).toContain(`'${key}', old.metadata -> '${key}'`);
    }
    expect(sql).toContain("new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(");
    // Devolve o NEW corrigido: o resto da escrita (status, nao lidas, previa) nunca e descartado.
    expect(sql).toContain("    'aiDebounceMs', old.metadata -> 'aiDebounceMs'\n  ));\n  return new;\nend;\n$$;");
    expect(sql).not.toMatch(/return old;/i);
  });

  it('o gatilho so dispara quando a escrita muda o marcador, antes da gravacao', () => {
    expect(sql).toContain(
      'create trigger trg_keep_newest_conversation_ai_pending_token\n'
      + 'before update of metadata on public.conversation_threads\n'
      + 'for each row\n'
      + "when (old.metadata ->> 'aiPendingToken' is distinct from new.metadata ->> 'aiPendingToken')\n"
      + 'execute function public.keep_newest_conversation_ai_pending_token();',
    );
    expect(sql).toContain('drop trigger if exists trg_keep_newest_conversation_ai_pending_token on public.conversation_threads;');
    expect(sql).toContain('revoke all on function public.keep_newest_conversation_ai_pending_token() from public, anon, authenticated;');
  });
});
