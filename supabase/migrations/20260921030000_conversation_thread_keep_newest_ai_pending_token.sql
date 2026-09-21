-- =============================================================================
-- Conversa: o marcador da resposta automatica (aiPendingToken) nunca volta no tempo.
--
-- Defeito provado em 21/09 (janela 4 da Aurora, logs de borda do Supabase): varios
-- gravadores leem a metadata INTEIRA da conversa, mudam o que querem e gravam tudo
-- de volta. Se a foto foi lida antes de o webhook gravar o marcador da mensagem nova
-- e a escrita cai depois, o marcador volta para o de uma mensagem ja respondida; a
-- resposta agendada acorda, ve que o marcador nao e o dela e sai calada. Dois casos
-- reais no mesmo teste: a tela do CRM marcando a conversa como lida (janela de 80 ms)
-- e o envio da propria IA gravando a foto lida antes de enviar (janela de 3 s).
--
-- O marcador e `<id da mensagem>:<milissegundos>`. Este gatilho mantem o de MAIOR
-- carimbo quando uma escrita traz um marcador mais antigo, malformado ou nenhum; o
-- resto da escrita passa intacto. Nenhum fluxo do codigo limpa o marcador de proposito.
-- O carimbo vem do relogio de cada instancia da Vercel; um desvio de milissegundos entre
-- duas mensagens quase juntas so troca QUAL das duas respostas sai, e a que sai ja tem a
-- outra no historico (a espera antes de responder e de 7 s). Nenhuma mensagem fica sem resposta.
-- Nao toca em tabela nenhuma (so compara OLD e NEW): security invoker, search_path vazio.
-- Travado em test/aiPendingTokenMonotonicMigration.test.ts.
-- =============================================================================

create or replace function public.keep_newest_conversation_ai_pending_token()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old text := old.metadata ->> 'aiPendingToken';
  v_new text := new.metadata ->> 'aiPendingToken';
begin
  if v_old is null or v_old !~ '^[^:]+:[0-9]{10,16}$' then
    return new;
  end if;

  if v_new ~ '^[^:]+:[0-9]{10,16}$'
     and split_part(v_new, ':', 2)::bigint >= split_part(v_old, ':', 2)::bigint then
    return new;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'aiPendingToken', old.metadata -> 'aiPendingToken',
    'aiPendingSince', old.metadata -> 'aiPendingSince',
    'aiPendingMessageId', old.metadata -> 'aiPendingMessageId',
    'aiDebounceMs', old.metadata -> 'aiDebounceMs'
  ));
  return new;
end;
$$;

revoke all on function public.keep_newest_conversation_ai_pending_token() from public, anon, authenticated;

drop trigger if exists trg_keep_newest_conversation_ai_pending_token on public.conversation_threads;
create trigger trg_keep_newest_conversation_ai_pending_token
before update of metadata on public.conversation_threads
for each row
when (old.metadata ->> 'aiPendingToken' is distinct from new.metadata ->> 'aiPendingToken')
execute function public.keep_newest_conversation_ai_pending_token();
