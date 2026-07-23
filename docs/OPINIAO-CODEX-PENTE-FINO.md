# Parecer independente — pente fino do BaseCRM

> Data: 2026-07-23  
> Branch auditada: `feat/funil-construtor` (`2461335`)  
> Referência de produção versionada: `main` (`be7fe35`)  
> Pedido: [`PEDIDO-OPINIAO-PENTE-FINO.md`](./PEDIDO-OPINIAO-PENTE-FINO.md)

## 0. Escopo, método e limites

Este parecer foi produzido depois da leitura, na ordem pedida, de:

1. [`README.md`](./README.md);
2. [`STATUS.md`](./STATUS.md);
3. [`decisoes.md`](./decisoes.md);
4. toda a pasta [`arquitetura/`](./arquitetura/);
5. [`modulos.md`](./modulos.md);
6. [`historia-e-origens.md`](./historia-e-origens.md);
7. e, por último, o pedido deste pente fino.

Para cada alegação, conferi o código atual, referências diretas, barrels,
imports dinâmicos, testes, snapshots e histórico Git quando isso mudava o
veredito. Também li os artefatos externos mencionados no pedido e executei
`ffprobe` localmente nos 12 MP4.

Não fiz:

- exclusão ou alteração de código;
- chamada ao banco local ou de produção;
- chamada direta ao PostgREST;
- execução da suíte do projeto;
- push ou deploy.

Portanto, quando a conclusão depende do estado vivo do banco, ela está
explicitamente marcada como inferência do schema versionado, não como
comportamento observado em runtime.

### Evidência e confiança

- **Código/artefato observado:** fato verificado diretamente numa fonte
  primária local. Isso confirma o conteúdo estático, não o estado vivo de um
  serviço.
- **[Inferred]:** consequência do código/schema que ainda depende do runtime.
- **Confiança alta:** somente quando há 3+ fontes independentes, incluindo uma
  primária; **média:** 2 fontes independentes; **baixa:** uma fonte, ASR ou
  inferência sem observação do runtime.

Por isso, este parecer usa “confirmado no código versionado” para fatos
estáticos e não promove automaticamente isso a confiança alta sobre produção.

## 1. Veredito executivo

1. **Seis candidatos podem ser removidos**, com impactos adjacentes descritos
   abaixo.
2. **Não recomendo apagar `smoke:integrations`.** O comando está quebrado, mas o
   script histórico cobria um E2E que a suíte atual não substitui. Recomendo
   reconstruí-lo de forma local-only e impossível de apontar para produção.
3. O maior risco achado não é código morto: são duas RPCs legadas
   `SECURITY DEFINER` sem filtro de tenant. `get_dashboard_stats` é mais sensível
   que `get_contact_stage_counts` porque agrega valores financeiros.
4. A redação de secrets de canais ficou incompleta: quatro endpoints devolvem
   `config` cru ao navegador. Isso deve ser corrigido antes do defeito visual
   “Webhook CRM: -”.
5. A C2 criou a origem auditável por UUID, mas a Visão Geral ainda mede
   `contacts.source` por texto. Hoje há duas verdades para “origem do lead”.
6. O módulo `decisions` não deve ser absorvido pela C2D. A C2D precisa observar
   o motor persistido; `decisions` é uma fila local, não tenantizada e com
   confirmação de ações insegura.
7. O call-list honra a fila “Hoje”, mas não o núcleo do conceito da secretária:
   o resultado preenchido no modal é descartado e “Feita” conclui sem registrar
   o que aconteceu.
8. Os 12 vídeos são matéria-prima, não pacote pronto: um MP4 está corrompido,
   três têm CTA de anúncio incompatível com WhatsApp e a documentação atual
   manda não reutilizar esses criativos no follow-up.

## 2. Auditoria item a item da remoção proposta

Nenhum arquivo foi removido neste ciclo.

| Candidato | Consumidor real ou oculto? | O que existe de aproveitável | Veredito |
|---|---|---|---|
| `features/activities/components/ActivityFormModalV2.tsx` | Nenhum import direto, dinâmico, barrel, teste ou referência histórica fora do próprio arquivo/docs. A tela monta a V1 em `features/activities/ActivitiesPage.tsx:7,113`. | A V2 usa RHF/Zod e o `Modal` comum (`:69-70,114`). Isso é uma direção válida para a V1, mas a V2 sempre exige `dealId`, enquanto a V1 não o exige durante a edição (`ActivityFormModal.tsx:124`). Não há regra de negócio exclusiva. | **Remover.** Registrar separadamente a dívida de portar validação e o `Modal` acessível para a V1. |
| `features/contacts/components/ContactFormModalV2.tsx` | Nenhum consumidor atual ou histórico. A tela e os testes usam explicitamente a V1 (`ContactsPage.tsx:10,137`; `ContactFormModal.test.tsx:4`). | A V1 é superior: origens, legado, lote fake, estado de envio e foco acessível. A V2 acrescenta apenas RHF/Zod e fecha depois de `onSubmit`, sem aguardar confirmação. | **Remover**, sem resgatar a implementação. |
| `features/boards/components/Modals/CreateDealModalV2.tsx` | Nenhum consumidor atual ou histórico. O fluxo real usa a V1 em `PipelineView.tsx:3,368`. | A V1 seleciona/cria contato, usa o usuário real e aguarda/trata falhas. A V2 chama `addDeal` sem `await`, não trata duplicidade e envia telefone que nem permite preencher. A V2 também usa o `Modal` acessível comum; a V1 não preserva automaticamente `role="dialog"`, foco preso/retornado e Escape (`components/ui/Modal.tsx:126-165`). | **Remover**, mas registrar as dívidas de schema e acessibilidade para a V1. |
| `features/ai-hub/tools/crmTools.ts` e pasta `tools/` | Só autorreferência em `crmTools.ts:122`; não há import, barrel, teste, autoload ou consumidor histórico. A implementação real é `createCRMTools` em `lib/ai/tools.ts:13`, consumida por `crmAgent.ts:6,507` e `lib/mcp/crmRegistry.ts:1,53`. | Há schemas conceituais sem `execute`, incluindo filtros baseados em enum legado e `suggestNextAction`. Não devem ser copiados para o executor atual sem redesenho multi-tenant. | **Remover.** Corrigir também `docs/modulos.md:127`: não há “execução fora da pasta”; a pasta está totalmente desconectada. |
| `lib/ai/actions.tsx` | É apenas um tombstone com `export {}`. O antigo `RSCChat` deixou de usá-lo no commit `583d4d7`; o fluxo real usa `AIHubPage`, `UIChat` e `/api/ai/chat`. | A versão histórica usava `streamUI`, `user_id` e a tabela antiga `stages`. Ressuscitá-la reintroduziria arquitetura superada. | **Remover**, sem resgate. |
| `useUpdateDealStatus` e export no barrel | Apenas definição em `lib/query/hooks/useDealsQuery.ts:443-518` e export em `lib/query/hooks/index.ts:16`. Nenhum consumidor atual ou histórico. `useMoveDeal` é a SSOT e cobre lifecycle, atividade e next-board. | Nada funcional. A invalidação antiga de dashboard já é coberta por realtime. | **Remover**, mas atualizar `cache-integrity.test.ts` e seu snapshot: o teste lê o arquivo como texto e espera duas ocorrências que desaparecerão. |
| `smoke:integrations` | A entrada existe em `package.json`, mas o `.mjs` não. O Git mostra um smoke de 261 linhas criado em `3c99d29` e removido em `dfb7c19` por política de scripts locais. | Cobria OpenAPI, autenticação, boards/stages, contatos, empresas, negócios, dois movimentos, atividades e webhook. Os endpoints centrais ainda existem e a cobertura atual não substitui esse percurso E2E. | **Não apagar. Resgatar.** Reescrever como artefato rastreado, local-only, com trava de loopback/ref de produção, tenant-fixture isolado e limpeza garantida. Como `.gitignore:85-86` ignora `scripts/`, o runner deve morar em caminho rastreável, como `test/integration/`, ou receber uma exceção explícita. |

### Impactos adjacentes da limpeza

1. Depois dos três V2, também ficam órfãos:
   - `contactFormSchema` e `ContactFormData`
     (`lib/validations/schemas.ts:110-118`);
   - `dealFormSchema` e `DealFormData` (`:142-155`);
   - `activityFormTypeSchema`, `activityFormSchema` e `ActivityFormData`
     (`:168-181`).

   Minha recomendação é não manter schema morto “para um dia”. Ou ele é portado
   para a V1 na mesma entrega, com testes, ou é removido e a dívida fica
   registrada fora do runtime.

2. `components/ai/RSCChat.tsx` também só se autorreferencia. Deve entrar na
   mesma inspeção final de `actions.tsx`.

3. A remoção de `useUpdateDealStatus` precisa atualizar o snapshot de
   integridade de cache; apagá-lo sem isso produzirá uma falha legítima de
   teste, não regressão do produto.

4. Ao concluir a limpeza/resgate, corrigir a documentação viva que ainda
   descreve os artefatos atuais:
   - `docs/arquitetura/camada-de-dados.md:93`;
   - `docs/modulos.md:127,140`;
   - `docs/arquitetura/apis-e-integracoes.md:105`;
   - `docs/STATUS.md:65`.

   O próprio `PEDIDO-OPINIAO-PENTE-FINO.md` deve permanecer intacto como
   registro histórico da alegação que este parecer verificou.

## 3. Correções explícitas das alegações originais

Esta seção existe para permitir a correção posterior do `STATUS.md` citando
este parecer.

### 3.1 `get_contact_stage_counts`

**Alegação original**

O pedido (`PEDIDO-OPINIAO-PENTE-FINO.md:52-58`) e o
`docs/STATUS.md:64` afirmam que `contacts.ts` chama a função com `{org_id}` no
“caminho normal multi-tenant”, fazendo a tela falhar por assinatura.

**Minha verificação**

A incompatibilidade existe, mas **não está no caminho da tela atual**:

- SQL legado sem argumento:
  `supabase/migrations/20251201000000_schema_init.sql:858-873`;
- método do serviço enviando `{ org_id }` e ocultando a incompatibilidade com
  `as any`: `lib/supabase/contacts.ts:207-215`;
- hook realmente usado:
  `lib/query/hooks/useContactsQuery.ts:211-229`;
- chamada real do hook:
  `contactsService.getAll(organizationId)` em `:218`;
- consumidor da tela:
  `features/contacts/hooks/useContactsController.ts:632-645`.

O commit `e954005` tirou a RPC do hook e deixou o método quebrado órfão.
Portanto:

- **“a assinatura do serviço está errada” — confirmado;**
- **“isso quebra a tela atual” — refutado;**
- **“a query da RPC não tem filtro de tenant” — confirmado no SQL
  versionado;**
- **“ela soma todos os tenants no banco vivo” — [Inferred], confiança baixa
  quanto ao runtime porque owner/FORCE RLS e grants efetivos não foram
  inspecionados neste ciclo.**

Há ainda um bug ativo diferente: `getAll()` usa `.limit(10000)` em
`lib/supabase/contacts.ts:289-300`. Assim, as contagens atuais ficam
silenciosamente incompletas acima de 10 mil contatos no tenant.

**Texto sugerido para corrigir o STATUS**

> `get_contact_stage_counts()` legado é `SECURITY DEFINER`, não filtra tenant e
> precisa ser removido/substituído. O método parametrizado do serviço tem
> assinatura inválida, mas está órfão; a tela atual conta no cliente via
> `getAll(orgId)` e fica limitada aos primeiros 10 mil contatos.

### 3.2 “Webhook CRM” mostrando `-`

**Alegação original**

O pedido (`PEDIDO-OPINIAO-PENTE-FINO.md:64-65`) chama o “-” de defeito
cosmético.

**Minha verificação**

O “-” em si é causado por uma correção de segurança:

- `toPublicChannelConnection` remove `apiKey` e `webhookSecret` e expõe apenas
  flags em `lib/channels/publicChannel.ts:27-48`;
- a UI ainda tenta ler `connection.config.webhookSecret` em
  `features/platform/tenants/TenantChannelsPage.tsx:326-329`;
- por isso mostra `-` em `:910-911` e torna “Copiar URL” inalcançável em
  `:1057-1078`;
- a ajuda continua mandando usar essa URL em `:1268`.

Isso seria cosmético no happy path, porque connect/healthcheck configuram o
webhook no servidor. Porém a auditoria achou um problema mais sério: quatro
rotas selecionam `config` e devolvem `channel: updated` sem aplicar
`toPublicChannelConnection`:

- connect: `connect/route.ts:156,163`;
- healthcheck, inclusive erro: `healthcheck/route.ts:121,128,156,162`;
- disconnect: `disconnect/route.ts:97,104`;
- send-test, inclusive erro: `send-test/route.ts:119,126,154,157`.

Consequência direta do código: o navegador de um usuário com
`whatsapp.manage_connection` **pode receber os secrets presentes em `config`**.
O connect efetivamente retorna o secret recém-criado; nas outras rotas, a
presença de `webhookSecret`/`apiKey` depende do estado da conexão. Isso não
reproduz o vazamento cross-role já corrigido, porque a rota exige permissão de
gestão, mas viola a regra “secrets nunca vão ao browser”.

**Texto sugerido para corrigir o STATUS**

> “Webhook CRM: -” é a consequência visual de a UI depender de um secret
> corretamente redigido. Além disso, connect/healthcheck/disconnect/send-test
> ainda retornam `config` cru a gestores; sanitizar esses DTOs antes de
> substituir a URL por status protegido/reconfiguração server-side.

### 3.3 `decisions` “100% placebo”

**Alegação original**

O pedido (`PEDIDO-OPINIAO-PENTE-FINO.md:66-68`) e o
`docs/STATUS.md:32,60` dizem que o módulo é 100% localStorage e que aprovar é
placebo.

**Minha verificação**

Metade é correta:

- o service guarda a fila em chaves globais de navegador
  `crm_decision_queue` e `crm_processed_decisions`
  (`decisionQueueService.ts:16-61`);
- `decisionQueueService.executeAction()` é realmente placeholder e sempre
  retorna sucesso (`:275-284`).

Mas esse método **não é o caminho usado pela interface**. O hook implementa um
segundo executor em `features/decisions/hooks/useDecisionQueue.ts:80-160`:

- cria atividade em `:103`;
- atualiza negócio em `:111`;
- conclui atividade em `:120`;
- abre WhatsApp/e-mail em `:125-147`.

Logo, as ações não são 100% placebo. O problema real é mais perigoso:
`addActivity`, `updateDeal` e `updateActivity` são disparadas sem `await`; o
executor retorna `true`, e `approveDecision` marca a decisão como aprovada em
`:178-182`. Uma falha assíncrona pode aparecer como sucesso.

Além disso, as chaves de localStorage não incluem organização nem usuário.
Trocar de tenant no mesmo navegador pode carregar nomes, valores e justificativas
de outro contexto.

**Texto sugerido para corrigir o STATUS**

> `decisions` é protótipo local e não tenantizado. O service tem executor
> placeholder, mas a UI usa outro executor que dispara mutações reais sem
> aguardá-las e pode marcar falha como aprovada. Quarentenar a rota; não
> absorver essa implementação na observabilidade C2D.

## 4. Diagnóstico dos bugs e ordem técnica

### 4.0 Severidade consolidada

Esta classificação separa impacto potencial de exploração comprovada:

- **P0 — incidente ativo comprovado:** nenhum achado deste ciclo. Não houve
  inspeção do banco vivo nem demonstração de exploração em produção.
- **P1 — corrigir primeiro:** as duas RPCs legadas potencialmente
  cross-tenant. A condição está no SQL versionado; a exposição viva precisa ser
  confirmada de forma read-only antes da migration.
- **P2 — correção necessária:** DTOs crus das quatro rotas de canal; RLS de
  `lead_sources` se a C2 atrasar; botão Editar sem ação; falso sucesso e falta
  de tenantização de `decisions`; descarte do outcome no call-list.
- **P3 — dívida/UX:** apresentação “Webhook CRM: -” depois da sanitização,
  código morto, documentação divergente e consolidações de fontes de verdade
  que não criam exposição imediata.

### 4.1 RPCs legadas: prioridade máxima

#### `get_contact_stage_counts()`

**Confirmado no schema versionado:**

- zero argumentos: `schema_init.sql:858`;
- `SECURITY DEFINER`: `:864`;
- consulta `contacts` sem `organization_id`: `:867-872`;
- `GRANT EXECUTE` a `authenticated`: `:2263`;
- a migration M6 fixa apenas o `search_path`; não acrescenta tenant gate.

Correção recomendada:

1. revogar execução e remover explicitamente a versão zero-arg — criar um
   overload não elimina a versão vulnerável;
2. criar `get_contact_stage_counts(p_organization_id uuid)` como
   `SECURITY INVOKER`, com filtro explícito e recusa para tenant sem acesso;
3. revogar `PUBLIC`/`anon` e conceder só a `authenticated`;
4. tornar `organizationId` obrigatório no serviço, retirar o fallback e ligar o
   hook à RPC segura;
5. provar isolamento e concorrência no Supabase local.

#### `get_dashboard_stats()`

Não há consumidor em `HEAD` nem em `main`. O dashboard real usa hooks em
`features/dashboard/hooks/useDashboardMetrics.ts:2-4,167-171`.

O SQL versionado, porém:

- declara explicitamente “sem filtro de tenant” em
  `schema_init.sql:783-784`;
- é `SECURITY DEFINER` em `:787`;
- soma negócios, pipeline, contatos, empresas, ganhos, perdas e atividades sem
  `organization_id` em `:792-800`;
- concede execução a `authenticated` em `:2258`.

**Prova de runtime solicitada:** não foi produzida. O escopo proibia banco e eu
não chamei `/rest/v1/rpc/get_dashboard_stats`. Portanto, a frase “uma chamada
PostgREST devolve métricas globais” fica classificada como **[Inferred] a partir
do SQL e dos grants versionados, com confiança baixa quanto ao runtime**, não
como resposta observada. O estado vivo pode ter owner, FORCE RLS ou grant
manual diferente, embora isso não esteja representado em migrations.

No próximo ciclo local, o teste deve:

1. criar dois tenants fictícios;
2. chamar a RPC pelo PostgREST local com um usuário de apenas um deles;
3. registrar o comportamento pré-fix;
4. aplicar a migration;
5. provar que a função antiga não existe/não executa e que nenhuma métrica
   cross-tenant retorna.

Minha recomendação é remover `get_dashboard_stats()` na mesma migration, sem
`CASCADE`. Antes do deploy, conferir logs/consumidores externos de forma
read-only; o repositório não prova que terceiros nunca chamaram a RPC.

### 4.2 Secrets retornando ao browser

Prioridade imediatamente abaixo das RPCs. O fix é pequeno e deve cobrir
respostas de sucesso **e de erro** das quatro rotas. O frontend ignora o campo
`channel` e recarrega o DTO seguro, então o melhor contrato é omiti-lo ou aplicar
`toPublicChannelConnection`.

Só depois disso a UI deve trocar “Webhook CRM: -” por:

- “Configurado e protegido” com `hasWebhookSecret`;
- instante/erro de configuração vindo de metadata;
- ação server-side “Reconfigurar webhook”.

Não reexpor a URL contendo secret.

### 4.3 RLS de `lead_sources`

Na referência `main`, a policy
`20260617000000_lead_sources.sql:38-44` usa
`can_operate_organization`; a definição do helper inclui `clinic_staff` e
`vendedor` em
`20260311013000_core_multi_tenant_rls.sql:56-68`.
Logo, usuários operacionais podem inserir, editar e excluir o catálogo dentro
do próprio tenant.

A branch C2A já substitui a policy por `lead_sources.manage` em
`20260722030000_c2a_lead_sources.sql:244-266`. O snapshot v3 nega
`lead_sources.manage` a `clinic_staff` e `vendedor` em
`20260722000000_c2a_permission_defaults_v3.sql:165-168,247-250` e ativa a v3 em
`:282-284`.

Não consultei o banco vivo. Minha recomendação:

- se o deploy da C2 for iminente, tornar essa migration gate obrigatório;
- se atrasar, preparar hotfix mínimo de policy em `main`;
- não aplicar isoladamente a migration C2A inteira, pois ela depende das
  migrations e do snapshot v3 anteriores.

### 4.4 Botão Editar de atividade

Bug confirmado:

- `features/boards/components/Modals/DealDetailModal.tsx:755` passa
  `onEdit={() => {}}`;
- `features/activities/components/ActivityRow.tsx:194-201` sempre renderiza o
  botão;
- a tela de Atividades possui fluxo de edição funcional;
- o teste do modal substitui `ActivityRow` por mock e não percebe o clique morto.

Correção mínima segura: tornar `onEdit` opcional e esconder o botão sem handler.
Se editar dentro do modal for requisito, reutilizar o fluxo já existente em vez
de duplicá-lo.

### 4.5 `decisions`

Não recomendo reconstruí-lo agora nem encaixá-lo na C2D.

Passo seguro:

1. ocultar/quarentenar a rota atual;
2. preservar apenas cards, textos e ideias dos analisadores;
3. construir futuramente uma central de ações server-side, tenantizada, com
   idempotência, CAS/versionamento, auditoria e erro explícito.

A observabilidade C2D deve ler `jobs`, `attempts`, `enrollments`, waits,
dead-letters e saúde do tick. Uma fila local de sugestões não é observabilidade
do motor.

### 4.6 Consolidações de fonte de verdade

Ordem segura:

1. **Consentimento.** Três modelos incompatíveis coexistem:
   - `lib/consent/consentService.ts` corresponde ao schema por
     `consent_type`;
   - `lib/supabase/consent.ts` trata apenas `AI_CONSENT`;
   - `lib/supabase/consents.ts` espera colunas inexistentes como
     `terms_accepted`, `privacy_accepted` e `ai_data_sharing`.

   A policy historicamente aberta foi corrigida por
   `20260630000000_m6_security_hardening.sql:105-115`; não há achado atual de
   RLS aqui. O problema é de contrato: `/api/ai/actions` traduz falta de API key
   em “AI consent required” (`route.ts:202-212`) sem consultar
   `user_consents`. Definir primeiro a política real e o gate server-side;
   depois consolidar serviços e constraints.

2. **Produtos.** Adotar TanStack Query como autoridade; mutations atualizam as
   mesmas query keys. Migrar `ProductsCatalogManager`; depois transformar
   `SettingsContext` em fachada temporária e remover o evento DOM
   `crm:products-updated`.

3. **`DealView`.** Criar um projetor puro com testes de caracterização; usá-lo
   nas duas queries de `useDealsQuery`; migrar `CRMContext`; apagar por último
   o helper órfão de `DealsContext`.

4. **`createStaticAdminClient`.** É duplicação de implementação, mas preserva
   uma fronteira válida: `lib/ai/tools.ts` não deve importar
   `next/headers`/`server-only`. Consolidar num core runtime-neutral e reexportar
   de `server.ts`. Baixa prioridade.

## 5. Achados adicionais não listados no pedido

### 5.1 Duas verdades para origem do lead

A C2C possui o caminho correto:

- `DealOriginSelector.tsx:73-78` chama
  `record_lead_source_attribution` por UUID;
- a RPC grava histórico e ponteiros de primeira/última origem.

Mas o caminho antigo continua ativo:

- `ContactFormModal.tsx:69-73` compara origem por nome;
- sem catálogo, volta a texto livre em `:219-227`;
- `useContactsController.ts:427,449` persiste `contacts.source`;
- a Visão Geral agrupa diretamente esse texto em
  `features/visao-geral/utils/leituraInteligente.ts:67-84`.

Assim, renomear uma entidade não quebra a automação v3, mas o painel “De onde
vem o lead” ainda pode separar nomes antigos/novos e ignorar o histórico
auditável. A afirmação do comentário `leituraInteligente.ts:67-68` de que
`contacts.source` é “alimentado por lead_sources/N1” é incompleta: o select
persiste o **nome**, não o UUID nem o evento.

Antes de dizer que a C2 entrega atribuição confiável:

1. definir o histórico como fonte do relatório;
2. manter `contacts.source` apenas como ponte legada claramente rotulada;
3. remover o fallback de texto livre da operação normal;
4. testar rename sem fragmentar métrica.

### 5.2 Call-list descarta o resultado

O conceito de três telas previa registrar, em um toque: Agendou,
Respondeu/vai pensar, Não atendeu ou Não tem interesse.

Hoje:

- `CallListTable.tsx:187-219` oferece Ligar, WhatsApp e “Feita”;
- `CallModal` coleta `outcome`, duração e notas;
- `CallListPage.tsx:66-73` ignora o objeto recebido por `onSave` e apenas chama
  `handleMarkDone`;
- `useCallListController.ts:86-104` conclui activity/task, sem persistir o
  resultado semântico.

Portanto, a fila diária foi bem aproveitada, mas o núcleo “registrar contato em
um botão” não foi entregue. Antes do piloto, o resultado deve persistir
atomicamente a interação, o outcome e o próximo passo. Mover etapa
automaticamente só deve ocorrer se existir regra de produto explícita; não
inferir isso do botão.

### 5.3 O documento de ativação já contém uma afirmação falsa

`docs/ativacao-cliente.md:93` diz que “F1–F9 + 12 vídeos” estão prontos,
esperando C3. Isso conflita com:

- o MP4 corrompido identificado abaixo;
- `02-followup/README.md:19`, que decide “Sem vídeo nos follows”;
- os três Markdown de cadência, que dizem “Vídeos removidos por ora”.

Corrigir a doc-mãe depois deste parecer para: “12 fontes localizadas; 11 MP4
tecnicamente válidos; payload editorial ainda não aprovado”.

## 6. Esquecidos aproveitáveis

### 6.1 Mapa célula a célula da planilha do Adel

É valioso, mas não deve virar integração agora.

Verificado em:

- `C:\Users\PC Gamer\WorkSync\workspaces\Cenoura Squad Mapper\ESTADO-v1-provisionamento.md:73,79-83`;
- `C:\Users\PC Gamer\Downloads\00 - Mapa XXXX .xlsx`;
- `C:\Users\PC Gamer\Downloads\TESTE - Mapa preenchido pelo CRM.xlsx`.

O material registra:

- 33 abas, 157 tabelas e 157 validações;
- contrato v1 final: escrever Q/R/E/F/G/N/B;
- D/H/O apenas para exceções;
- nunca escrever em T/Visto nem na aba Mensal;
- W/Z5 pertencem ao caixa físico v2;
- o arquivo `TESTE - Mapa preenchido pelo CRM.xlsx` contradiz o contrato final:
  deixa B vazio e preenche T; não serve como fixture dourada;
- `Jéssica IA.xlsx` não estava mais disponível no local citado.

Timing recomendado:

1. **agora:** preservar o mapa como contrato/data dictionary;
2. **depois de C2D e do fluxo operacional estável:** construir uma fatia
   financeira própria de exportação/espelho, não sync bidirecional;
3. antes de implementar: obter o workbook atual de cada profissional, mapear
   método/bandeira/tipo explicitamente e validar no Excel real, com recálculo e
   sem repair warning;
4. caixa físico permanece v2.

### 6.2 Cadência F1–F9 e os 12 vídeos

A cadência de nove pontos está confirmada: D+0, D+1, D+2, D+4, D+6, D+9,
D+13, D+18 e D+25. O PDF antigo de lentes inclui vídeo em F3/F4/F7; os
Markdown mais novos retiram vídeo para não repetir anúncios.

Base dos arquivos:

`C:\Users\PC Gamer\Desktop\Videos Follow-up Dra Jessica\COMPRIMIDOS-WHATSAPP`

O status técnico abaixo vem de `ffprobe` executado diretamente em cada arquivo.
O status editorial vem de ASR local automático; por não ter revisão humana,
a confiança das frases é baixa, como exigido.

| # | Arquivo | Tamanho / probe | CTA para follow-up |
|---:|---|---|---|
| 1 | `LENTES\F3 - Video 2 (medo artificial).mp4` | 13.107.248 B; **inválido**, exit 1, `moov atom not found`; sem codec/duração recuperável. O MOV original de mesmo nome está íntegro. | O MOV original diz “clique no botão aqui embaixo”. **Incompatível**, mas a equivalência de conteúdo MP4↔MOV é inferência por basename. Confiança baixa. |
| 2 | `LENTES\F3 - Video 6 (branco exagerado).mp4` | 13.358.040 B; H.264/AAC; 1080×1920; 43,300 s. | “Clique em Saiba Mais para agendar sua avaliação.” **Incompatível** com mídia no WhatsApp. Confiança baixa (ASR). |
| 3 | `LENTES\F4 - Transformação de um sorriso.mp4` | 13.835.030 B; H.264/AAC; 720×1280; 68,467 s. | Nenhum CTA explícito detectado. Sem incompatibilidade técnica; decisão editorial pendente. Confiança baixa. |
| 4 | `LENTES\F5 - As pessoas não têm medo de lentes.mp4` | 13.299.409 B; H.264/AAC; 1080×1920; 22,034 s. | O final ficou ininteligível no ASR; possivelmente “Agende sua avaliação”. **Não verificado.** |
| 5 | `LENTES\F5 - Dúvida do paciente.mp4` | 13.424.413 B; H.264/AAC; 1080×1920; 44,070 s. | Diálogo termina em “então eu vou agendar”; não há botão/click externo detectado. Confiança baixa. |
| 6 | `LENTES\F7 - Video 8 (primeira impressão).mp4` | 13.340.522 B; H.264/AAC; 1080×1920; 47,135 s. | “Agende sua avaliação clicando no botão Saiba Mais aqui embaixo.” **Incompatível**. Confiança baixa (ASR). |
| 7 | `ORTODONTIA\F3 - Aparelho não é só para adolescente.mp4` | 13.523.031 B; H.264/AAC; 1080×1920; 35,833 s. | Provável “Agende sua avaliação”. Sem botão; compatível em substância, mas genérico. Confiança baixa. |
| 8 | `ORTODONTIA\F5 - Aparelho sem planejamento (obra sem projeto).mp4` | 13.153.953 B; H.264/AAC; 1080×1920; 34,410 s. | Provável “Agende sua avaliação, te espero aqui”. Sem botão; compatível em substância. Confiança baixa. |
| 9 | `PELE-PEPTIDEOS-BOTOX\F3 - Pele envelheceu do nada.mp4` | 13.320.762 B; H.264/AAC; 1080×1920; 46,867 s. | “Agende sua avaliação e descubra o que a sua pele precisa.” Compatível com WhatsApp, embora genérico. Confiança baixa. |
| 10 | `PELE-PEPTIDEOS-BOTOX\F4 - Olhar cansado (dorme 8h).mp4` | 13.304.956 B; H.264/AAC; 720×1280; 62,800 s. | Provável “Agende sua avaliação. Espero você”. Sem botão; compatível em substância. Confiança baixa. |
| 11 | `PELE-PEPTIDEOS-BOTOX\F5 - Peptídeos funcionam.mp4` | 13.251.219 B; H.264/AAC; 1080×1920; 49,201 s. | Provável “Agende uma avaliação”. Sem botão; compatível em substância. Confiança baixa. |
| 12 | `PELE-PEPTIDEOS-BOTOX\F6 - Protocolo (botox + ativos).mp4` | 13.450.673 B; H.264/AAC; 720×1280; 83,938 s. | Provável “Descubra o que sua pele precisa, agende sua avaliação”. Sem botão; compatível em substância. Confiança baixa. |

Conclusão:

- **tecnicamente válidos:** 11/12;
- **corrompido:** exatamente
  `LENTES\F3 - Video 2 (medo artificial).mp4`;
- **CTA de anúncio incompatível identificado:** itens 1, 2 e 6;
- **os outros nove não estão automaticamente aprovados:** continuam sendo
  criativos já usados em aquisição, e a decisão editorial mais nova é não
  repeti-los no follow-up.

Uso recomendado:

1. usar os 12 como conjunto de aceitação técnica de C3, depois de reencodar o
   item 1;
2. não semear nem publicar como mensagens antes de adjudicar qual documento de
   conteúdo é canônico;
3. substituir `Saiba Mais` por CTA nativo do canal, preferencialmente
   “responda por aqui”;
4. validar compliance e template/janela do WhatsApp;
5. produzir mídia nova se a decisão “não repetir anúncio” permanecer.

### 6.3 Conceito das três telas da secretária

O desenho original ainda tem valor como teste de simplicidade, não como shell
literal obrigatório.

O call-list atual honra:

- fila de hoje;
- prioridade por atraso/data;
- nome, telefone e badge F1–F9;
- ações Ligar e WhatsApp.

Não honra:

- persistir em um toque o resultado do contato;
- resultados de negócio do desenho original;
- navegação minimalista Hoje/Novo/Buscar.

O conceito também propõe um formulário “Novo paciente” curto, com entidades
selecionáveis. Não tratei a ausência dessa equivalência como regressão
confirmada porque esta revisão do código atual se concentrou no call-list, não
num aceite completo do cadastro.

Minha recomendação é não reconstruir três páginas paralelas. Corrigir o
call-list atual: resultado grande, nota opcional e persistência atômica. O
conceito deve virar critério de aceite para a operação da secretária.

### 6.4 Blueprint concierge multi-tenant

Não recomendo reiniciar o blueprint como outro projeto quando entrar o segundo
cliente. Grande parte já virou produto: tenant, Platform Admin, provisioning,
branding, canais, conversas e permissões. Mas ele ainda contém decisões
arquiteturais próprias que o runbook não substitui.

Classificação recomendada agora: **arquitetura-alvo parcialmente implementada**.
Antes de arquivá-lo, produzir uma matriz `as-built × lacunas` e migrar as
decisões ainda canônicas para a documentação-mãe.

`docs/ativacao-cliente.md` deve permanecer como runbook operacional, depois de
corrigir a afirmação falsa sobre os vídeos. O segundo cliente deve disparar:

1. matriz rápida entre blueprint, as-built e lacunas;
2. tenant-sombra;
3. execução integral do checklist de ativação;
4. validação de isolamento, permissões, canal e
   revogação/desativação já disponível;
5. teste de teardown integral quando O5/lifecycle existir;
6. registro das lacunas realmente específicas do novo cliente.

Assim, o blueprint não volta a comandar uma reconstrução, mas também não é
arquivado prematuramente.

### 6.5 Documentos da era março

Não promover arquivos inteiros. Extrair invariantes e arquivar o restante:

- `crm-business-rules.md`: preservar isolamento, separação agência/cliente,
  takeover humano e gates explícitos. A proibição de automação continua sendo
  guardrail de produção enquanto a C2 não estiver deployada e aceita. Depois,
  superar apenas a proibição absoluta, preservando configuração explícita,
  validação e safe mode.
- `basecrm-engineering-playbook.md`: preservar tenant-aware, cache por tenant,
  fail-fast, testes mínimos/direcionados, typecheck/lint/build e mudanças
  incrementais. Os papéis listados continuam coerentes; não classificá-los
  como antigos. Atualizar os gates para o `precheck` atual, que também executa
  testes, e arquivar apenas trechos arquiteturais superados.
- `workspace-navigation-spec.md`: `arquitetura/rotas-e-navegacao.md` ainda é
  principalmente um inventário. Migrar antes as invariantes de troca de
  tenant/board, regressões conhecidas e checklist; só depois arquivar.
- `clinic-platform-blueprint.md`: manter como arquitetura-alvo parcialmente
  implementada até existir a matriz `as-built × lacunas`; depois migrar
  decisões canônicas e arquivar com o runbook operacional apontado
  separadamente.

Arquivar significa mover para `docs/arquivo/` com banner de supersessão e link
para a fonte atual, nunca apagar memória histórica.

## 7. Ordem recomendada por trilho

As letras abaixo identificam os trilhos do pedido, não uma ordem alfabética de
risco. Segurança vem antes.

| Ordem | Trilho | Entrega recomendada | Gate |
|---:|---|---|---|
| 1 | **(b) Próximo ciclo Codex — migrations** | Migration local para remover/substituir `get_contact_stage_counts()`, remover `get_dashboard_stats()`, fechar grants e provar o PostgREST com dois tenants fictícios. | `test:local` verde; prova pré/pós-fix; nenhuma produção. |
| 2 | **(a) Limpeza imediata pós-parecer — segurança de código** | Sanitizar respostas de connect/healthcheck/disconnect/send-test, inclusive erros. | Testes garantindo ausência de `apiKey`/`webhookSecret` em todos os DTOs. |
| 3 | **(a) Limpeza imediata pós-parecer — mortos e docs** | Remover os seis candidatos aprovados, schemas órfãos e revisar `RSCChat`; atualizar snapshot de cache e a documentação viva enumerada no §2. | `precheck:fast` e `test:local`; nenhum import oculto; docs sem referência falsa. |
| 4 | **(a) Limpeza imediata pós-parecer — resgate independente** | Reconstruir `smoke:integrations` local-only em caminho rastreável, com trava dura contra produção e cleanup. Não é gate automático da C2: o percurso cobre principalmente Public API e webhook. | Duas execuções seguidas no Supabase local sem resíduos. |
| 5 | **(a) Correções operacionais pós-parecer** | Quarentenar `decisions`; esconder/ligar Editar atividade; corrigir status do webhook; persistir resultado do call-list. | Testes de falha, tenant switch e fluxo de um toque. |
| 6 | **(c) Deploy da C2** | Levar obrigatoriamente a RLS nova de `lead_sources`; corrigir/rotular a dupla verdade `contacts.source` × histórico antes de afirmar que o painel mede origem auditável. | Revisão independente, migrations na ordem, safe mode e envio real desligado. |
| 7 | **(d) C2D** | Observabilidade nativa de tick, jobs, attempts, waits, enrollments, `unknown` e `dead_letter`; tarefas/mover reais. | Não absorver o código atual de `decisions`. |
| 8 | **(b) Próximo ciclo Codex — consolidação posterior** | Fechar o contrato real de consentimento e seu gate server-side; só então consolidar serviços e constraints. | Ciclo separado do hotfix das RPCs; testes de tenant e de consentimento real. |
| 9 | **(a) Limpeza técnica posterior** | Consolidar produtos, `DealView` e static admin, nessa ordem, sem misturar com o hotfix nem bloquear a C2. | Testes de caracterização e migração de cada consumidor antes de apagar a fonte antiga. |

### Sequenciamento prático

Os itens 1 e 2 formam um **hotfix de segurança pequeno e independente**. Mesmo
que sejam construídos na branch atual, devem ser revisáveis/cherry-pickáveis sem
carregar toda a C2. A limpeza de mortos/docs e o resgate do smoke também são
independentes entre si. Em particular, o smoke agrega cobertura, mas **não deve
bloquear automaticamente o deploy da C2** sem uma mudança da C2 que alcance a
Public API ou o webhook.

O gate específico do trilho **(c)** é a correção de `lead_sources`, a coerência
da origem auditável, a revisão independente, as migrations na ordem e o safe
mode. C2D continua sendo o trilho **(d)** seguinte.

As consolidações técnicas ficam mapeadas, mas fora do hotfix:

`(b) consentimento → (a) produtos → (a) DealView → (a) static admin`.

Os itens de aproveitamento que não são correções desta rodada ficam
explicitamente fora dos quatro trilhos: vídeos pertencem à **C3**, e a planilha
do Adel a uma futura fatia financeira pós-C2D.

## 8. Resposta final às perguntas do pedido

- **Pode apagar os V2, `crmTools`, `actions.tsx` e
  `useUpdateDealStatus`?** Sim, observando os órfãos e o snapshot listados.
- **Pode apagar `smoke:integrations` do package?** Não recomendo; resgatar o
  E2E de forma segura entrega mais valor que apagar o aviso.
- **`get_contact_stage_counts` quebra a tela?** Não hoje. O método inválido está
  órfão; a RPC insegura continua sendo dívida de segurança.
- **`get_dashboard_stats` pode sair junto?** Sim, após checagem read-only de
  consumidores externos. A exposição runtime não foi executada neste ciclo;
  foi inferida do SQL/grant.
- **RLS de origem precisa ação antes da C2?** Só se o deploy atrasar. Caso
  contrário, trate a migration C2A como gate obrigatório.
- **`decisions` entra na C2D?** Não. Quarentenar; aproveitar só UX/conceitos
  numa futura central persistida.
- **Quando usar a planilha do Adel?** Em fatia financeira própria, depois da
  estabilização do motor/C2D e com fixture atual validada.
- **Os vídeos entram direto na C3?** Como fixtures técnicas, sim; como conteúdo
  publicado, não.
- **O segundo cliente reabre o blueprint?** Não. Ele executa o checklist de
  ativação num tenant-sombra e revela somente as lacunas reais.
- **Docs de março: promover ou arquivar?** Extrair invariantes para a doc-mãe e
  arquivar os originais com banner de supersessão.

## 9. Estado ao encerrar o parecer

- nenhum arquivo de produção foi alterado;
- nenhum candidato foi removido;
- nenhum banco foi acessado;
- nenhum push/deploy foi feito;
- único artefato criado: este parecer.
