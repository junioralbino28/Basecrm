# IMPL-LOG — Multi-número / Caixa unificada

Data: 2026-07-16  
Branch: `feat/multi-numero-inbox`  
Base recebida: `fd84dff` (`main` com E1 + E2)

## Resultado implementado

- Criação de instância Evolution pelo CRM com o contrato travado de `/instance/create`.
- Cadastro simples de número com apenas nome de identificação e telefone; `instanceName` e segredo do webhook são gerados no servidor.
- Pareamento create-first, com fallback para instância já existente somente em erros reconhecidos como duplicidade.
- Exclusão da conexão com logout Evolution best-effort e preservação das conversas via FK `ON DELETE SET NULL`.
- UI simples disponível ao admin da clínica; infraestrutura técnica permanece recolhida em **Avançado** e restrita ao fluxo agency-admin.
- Controle `config.aiEnabled` por número, com default público `true` e PATCH parcial que não apaga credenciais/configuração Evolution.
- Número com IA desligada cria/reabre inbound em `human_queue` e possui curto-circuito explícito antes da geração de resposta nativa.
- Caixa de conversas com seletor **Todos os números**, filtro por conexão e selo de origem; threads de conexão removida exibem **Número removido**.

Não houve migration nem mudança de schema. Nenhum banco de produção foi acessado ou alterado.

## Decisões de implementação

1. O fluxo de clínica usa payload mínimo no POST. Campos técnicos só entram no payload quando um agency-admin os preenche no painel avançado.
2. O connect tenta criar a instância primeiro. Apenas uma resposta de duplicidade reconhecida permite buscar novo QR/código da instância existente; erros desconhecidos continuam visíveis.
3. Excluir número remove somente `channel_connections`; conversas não são apagadas.
4. `aiEnabled !== false` preserva o comportamento anterior. Somente o valor booleano explícito `false` desliga a IA.
5. O estado `selectedConnectionId` da caixa é independente do `activeConnectionId` usado pelo modal de pareamento.
6. O gerador do snapshot E2 passou a preservar o line ending do arquivo para evitar drift falso em worktrees Windows com `core.autocrlf=true`; conteúdo/permissões E2 não foram alterados.
7. `apiKey` e `webhookSecret` são redigidos de todo DTO enviado ao browser, inclusive para managers; a UI recebe apenas configuração não sensível e indicadores de presença/last4.

## TDD e testes adicionados

O ciclo RED → implementação → GREEN foi executado por tarefa.

- `lib/channels/evolution.test.ts`: contrato exato de criação, extração de QR/código e regressões de mídia.
- Rotas POST/connect/DELETE/PATCH: payload simples, create-first idempotente, logout best-effort, escopo tenant e merge seguro de `aiEnabled`.
- `TenantChannelsPage.test.tsx`: modo simples, modo avançado, POST → connect → QR no modal, confirmação de exclusão e toggle de IA.
- `publicChannel.test.ts`: exposição de `aiEnabled` com default `true` e redação de token/segredo para todos os perfis do browser.
- `routing.test.ts` e `route.aiGate.test.ts`: `human_queue` com IA desligada e curto-circuito antes de consultar thread/gerar resposta.
- `TenantConversationsPage.test.tsx`: seletor, selo, fallback de número removido e filtro da lista.

## Verificação em não-produção

Ambiente: Supabase local em `127.0.0.1`, iniciado com a CLI. As variáveis dos testes foram obtidas de `npx supabase status -o env` e a URL foi validada como loopback antes de cada precheck. `.env.local` não foi usado.

- Portões intermediários `npm run precheck:fast`: verdes após T2–T7.
- Portão final fresco `npm run precheck:fast`: lint 0, typecheck 0, **145 arquivos de teste aprovados; 666 testes aprovados e 1 skipped** (exit code 0; duração total 207,4 s).
- Smoke SQL transacional no Postgres local:
  - inseriu dois números no mesmo tenant;
  - vinculou uma thread ao primeiro número;
  - excluiu a conexão;
  - confirmou a thread preservada com `channel_connection_id IS NULL`;
  - finalizou com `ROLLBACK`.

O portão final foi executado depois de todo o código e dos testes estarem nos commits locais. A atualização posterior deste arquivo registra apenas a evidência obtida.

## Commits locais

- `425b2ce` — `feat(channels): cria instancia Evolution`
- `47dd5fd` — `fix(e2): preserva line endings do snapshot`
- `38ab1fa` — `feat(channels): simplifica cadastro de numero`
- `0f7df92` — `feat(channels): cria ou repareia instancia`
- `a397a2c` — `feat(channels): exclui numero com logout best effort`
- `c81c682` — `feat(channels): adiciona gestao simplificada de numeros`
- `8ac2381` — `feat(channels): controla ia por numero`
- `2c6b3d7` — `feat(conversations): unifica caixa por numero`
- `bde91d0` — `fix(channels): redige segredos no browser`

## Limites e próximo portão

- Não houve push, deploy ou aplicação em produção.
- O Supabase local foi o único banco usado.
- O diff e o SQL/comportamento devem ser revisados pelo Claude em `REVIEW.md`.
- O Junior valida no localhost e aprova antes de qualquer merge/deploy.
