-- =============================================================================
-- Chave da Groq por organização: SÓ para transcrever áudio recebido no WhatsApp
-- (SPEC-midia-recebida v2, D4: a chave é sempre da organização dona da conexão;
-- nunca variável de ambiente, nunca chave de outra organização).
--
-- A Groq NÃO é provedor de conversa: `ai_provider` continua google|openai|anthropic
-- e nenhuma tela ganha opção nova. A coluna só é lida pelo módulo de mídia, no
-- servidor, com service_role.
--
-- SEGREDO: esta coluna NÃO entra em nenhum `grant select (...)`. Desde a M6
-- (20260630020000) o SELECT de `authenticated` em `organization_settings` é uma
-- LISTA FECHADA de colunas, então a coluna nova nasce invisível para o navegador,
-- como `ai_google_key` e `meta_capi_access_token`. Escrita segue pela RLS
-- `can_configure_organization`, como as outras chaves. Aditiva: nada existente muda.
-- =============================================================================

alter table public.organization_settings
  add column if not exists ai_groq_key text;

comment on column public.organization_settings.ai_groq_key is
  'Chave da Groq (transcrição de áudio recebido). Segredo: sem SELECT para authenticated/anon; leitura só por service_role.';
