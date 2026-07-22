# IMPL-LOG — C2A (fundação de etiquetas e origens)

Data: 2026-07-22  
Branch: `feat/funil-construtor`  
Escopo executado: somente C2A de `PEDIDO-C2A.md`, com a correção obrigatória de
`REVIEW-PLANO-C2A.md`. Roteamento, tela, `schemaVersion: 3` e mídia não foram
iniciados.

## Resultado

A C2A foi concluída como fundação invisível e aditiva:

- `public.tags` foi evoluída preservando `id`, `name` e `color`; não foi criada
  uma segunda tabela de etiquetas;
- categorias e etiquetas usam UUID estável, nome normalizado, cardinalidade,
  arquivamento e auditoria;
- `Indicação`, `indicacao` e espaços excedentes convergem para a mesma identidade,
  inclusive sob requisições concorrentes;
- etiquetas arquivadas continuam ocupando sua chave normalizada, permitindo que a
  interface futura ofereça restauração em vez de criar outra identidade;
- atribuições de etiquetas são históricas e expõem somente operações
  `add/remove/set-primary`; reaplicar depois de remover cria uma linha nova;
- a primeira etiqueta de uma categoria vira principal automaticamente, e a
  cardinalidade `single` substitui a atribuição anterior na mesma transação;
- `deals.tags` foi mantido como ponte textual para snapshots v2 e é atualizado
  pelas RPCs de atribuição;
- o backfill usa `provenance = legacy_migration`, `applied_at = null` e
  `applied_by = null`; `recorded_at` registra somente o instante real da migração;
- colisões de normalização e etiquetas sem organização vão para revisão humana.
  Nenhum tenant é fabricado e nenhuma atribuição ambígua é criada;
- dependências textuais v2 de gatilhos e casos de `switch` foram materializadas e
  permanecem sincronizadas por triggers de rascunho/publicação;
- arquivar etiqueta usada pela versão publicada ativa é bloqueado com orientação
  para pausar ou republicar a automação;
- a limpeza total remove automações antes das etiquetas e agora informa
  explicitamente essa consequência na zona de perigo;
- `lead_sources` foi evoluída, sem tabela paralela, com nome normalizado, código
  estável opcional e arquivamento;
- a RLS antiga de `lead_sources` foi corrigida: `clinic_staff` e `vendedor` leem e
  atribuem, mas não criam, editam nem excluem o catálogo;
- o delete físico saiu do serviço; o caminho normal agora é `archive()`;
- o histórico de origem registra negócio/contato, estado conhecido ou
  desconhecido, canal, UTMs, click IDs, referrer, campanha, proveniência e chave
  de idempotência;
- primeira e última origem do negócio são atualizadas na mesma transação do
  evento idempotente;
- `contacts.source` permaneceu intacto e não gerou histórico retroativo;
- todas as relações operacionais usam FKs compostas com `organization_id`.

## Permissões v3

O catálogo passou de 37 para 41 permissões. Os snapshots v1 e v2 continuam
congelados com 222 linhas cada; v3 tem 246 linhas e foi ativada atomicamente.

| Permissão | Defaults ativos |
| --- | --- |
| `tags.manage` e `lead_sources.manage` | `admin`, `agency_admin`, `agency_staff`, `clinic_admin` |
| `tags.assign` e `lead_sources.assign` | todos os papéis acima + `clinic_staff` + `vendedor` |

O teste real do Supabase confirmou `active_version = 3` e resolução fail-closed.

## Migrations novas

| Migration | Responsabilidade |
| --- | --- |
| `20260722000000_c2a_permission_defaults_v3.sql` | snapshot e ativação das quatro permissões |
| `20260722010000_c2a_tag_taxonomy.sql` | categorias, evolução de `tags`, atribuições e RPCs |
| `20260722020000_c2a_legacy_tag_bridge.sql` | backfill, revisão humana e dependências v2 |
| `20260722021000_c2a_tag_delete_cascade.sql` | preserva guards diretos sem bloquear cascata de tenant |
| `20260722030000_c2a_lead_sources.sql` | catálogo, RLS, histórico e ponteiros de origem |

Nenhuma migration anterior foi modificada.

## Commits

| Fase | Commit | Descrição |
| --- | --- | --- |
| Permissões | `5c837cc` | `feat(permissoes): ativa defaults v3 para etiquetas e origens` |
| Taxonomia | `72c9c33` | `feat(etiquetas): cria taxonomia e atribuicoes auditaveis` |
| Legado/dependências | `3b66c9c` | `feat(etiquetas): migra legado e materializa dependencias v2` |
| Origens | `6f92036` | `feat(origens): adiciona historico auditavel e corrige RLS` |
| Contrato herdado | `1a6cec0` | `test(origens): atualiza contrato de gestao do catalogo` |
| Limpeza | `dcdb2f0` | `fix(configuracoes): explicita limpeza de automacoes` |

## Evidências de TDD

As baterias novas foram executadas primeiro em RED por ausência das tabelas/RPCs.
Depois da implementação, cobrem:

- três criações concorrentes de etiqueta retornando o mesmo UUID;
- dedupe sem acento, caixa ou espaços excedentes;
- `clinic_staff` aplicando/removendo etiqueta e sendo recusado na gestão;
- reentrada criando novo evento de atribuição;
- FK cross-tenant recusando a escrita com `23503`, mesmo via service role;
- backfill sem data/autor inventados e sem alterar `deals.tags`;
- colisão e órfã registradas para revisão sem atribuição silenciosa;
- dependências v2 de trigger e switch em draft e versão publicada;
- bloqueio acionável ao arquivar etiqueta publicada;
- limpeza automação → etiqueta e cascata de exclusão de tenant;
- `clinic_staff` atribuindo origem, mas sem gestão do catálogo;
- retry concorrente da mesma origem retornando um único evento;
- origem desconhecida explícita e ponteiros primeira/última atômicos;
- preservação de `contacts.source` sem backfill fabricado.

O baseline observado antes da implementação era **831/831** — um teste acima do
número 830 registrado no pedido. Gate final:

- `npm run test:local`: **186 arquivos, 848 testes passando, 0 falha**;
- `npm run precheck:fast`: lint e TypeScript verdes; **714 testes passando, 134
  ignorados, 0 falha**;
- `supabase db lint --local --level warning`: nenhum erro de schema.

O runner ainda imprime um `DELETE ... deal_notes ... 400` de uma suíte legada,
mas essa suíte e o gate terminam verdes; não é falha introduzida pela C2A.

## Nota operacional do Supabase local

A migration de dependências precisou de diagnóstico porque o CLI compacto ocultou
a mensagem SQL. O arquivo exato foi executado com `psql -1` (transação única) no
container local; após sucesso integral, somente o histórico **local** foi marcado
como aplicado com `supabase migration repair --local`. Não houve `db reset`.

## Segurança operacional

- Somente o Supabase local em `127.0.0.1:54321` foi usado.
- O projeto de produção `eqidsihasmwwamkaqfka` não foi acessado.
- `automation_live_enabled` permaneceu `false` em todas as organizações locais.
- Todas as automações locais permaneceram com `delivery_mode = 'simulation'`.
- Não houve push nem deploy.

## Como o Junior valida esta fatia

A C2A não altera tela por decisão de escopo. O aceite é a bateria automatizada:

1. Abra um terminal no repositório com o Docker/Supabase local ativo.
2. Rode `npm run test:local`.
3. O resultado esperado é `186 passed` e `848 passed`, sem falhas.

A experiência visível de selecionar/criar etiquetas entra somente na C2C. O
roteamento que cria inscrições entra na C2B.
