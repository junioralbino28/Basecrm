-- =============================================================================
-- RLS fase 2 (parcial, pré-N4): ai_conversations + ai_audio_notes
-- =============================================================================
-- Achado do advisor Supabase (2026-06-10): ambas tinham policy
-- "Enable all access for authenticated users" USING(true)/WITH CHECK(true)
-- — qualquer autenticado de QUALQUER tenant lia/escrevia.
--
-- Fato verificado antes de blindar: as duas estão VAZIAS e NENHUM código do
-- app as referencia (só schema_init/reset) — são slots do schema inicial.
-- Não têm organization_id; o modelo natural é POR DONO (user_id).
--
-- Policy: dono lê/escreve as próprias linhas. Quando o N4/copiloto passar a
-- usá-las, o código DEVE gravar user_id = auth.uid() (a WITH CHECK força).
-- As outras 8 tabelas USING(true) do achado ficam pro M6 (sem PII de paciente).
-- =============================================================================

drop policy if exists "Enable all access for authenticated users" on public.ai_conversations;
drop policy if exists "ai_conversations_own_rows" on public.ai_conversations;
create policy "ai_conversations_own_rows"
  on public.ai_conversations
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Enable all access for authenticated users" on public.ai_audio_notes;
drop policy if exists "ai_audio_notes_own_rows" on public.ai_audio_notes;
create policy "ai_audio_notes_own_rows"
  on public.ai_audio_notes
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
