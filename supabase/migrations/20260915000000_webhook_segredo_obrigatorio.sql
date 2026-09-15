-- Webhook da Evolution: segredo obrigatório (parecer do Codex, B1/I7 — gates G3/G11/G13).
--
-- Antes: conexão sem `config.webhookSecret` era "legada" e o webhook aceitava QUALQUER POST
-- (nem o instanceName era conferido). Um inbound forjado disparava a IA pelo número do cliente
-- para qualquer telefone, resolvia esperas do funil e criava marco de conversão para a Meta.
--
-- Agora (código): o webhook só aceita POST com o segredo da conexão (cabeçalho `x-webhook-secret`;
-- a query string `?secret=` continua aceita só para registros antigos). Conexão sem segredo é
-- recusada com 401.
--
-- Esta migration preenche o segredo em toda conexão que não tem (32 caracteres hexadecimais, o
-- mesmo formato que o CRM gera ao criar a conexão). Só escreve onde está vazio: nunca troca um
-- segredo existente, porque a Evolution do cliente já está registrada com ele.
--
-- Consequência operacional: uma conexão que foi preenchida aqui só volta a receber mensagens depois
-- que a tela de conexões rodar o healthcheck (ou "Gerar QR code"), que re-registra o webhook na
-- Evolution com o segredo novo. Em 15/09/2026 a única conexão de produção já tinha segredo, então
-- esta migration não muda nenhuma linha lá; fica como rede de segurança para linhas futuras.
--
-- Aditiva: sem DROP, sem alteração de coluna.

update public.channel_connections
set config = coalesce(config, '{}'::jsonb)
    || jsonb_build_object('webhookSecret', replace(gen_random_uuid()::text, '-', '')),
    updated_at = now()
where nullif(btrim(coalesce(config->>'webhookSecret', '')), '') is null;
