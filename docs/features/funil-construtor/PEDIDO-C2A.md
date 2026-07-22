# Pedido de execução — Entrega C2A (fundação das etiquetas e origens)

> Primeira fatia da C2. **Invisível**: nenhuma mudança de tela, nenhum roteamento
> ligado. É o análogo da C1A — contrato de dados e segurança primeiro, para a
> tela e o motor virem por cima sem retrabalho.

## Por que a C2 foi fatiada

A C2 é a entrega que faz a automação **funcionar de verdade**: hoje o construtor
publica, mas **ninguém entra sozinho no fluxo**. Ela é grande demais para uma
rodada, então vai em quatro:

| Fatia | O que entrega | Visível? |
|---|---|---|
| **C2A** (esta) | tabelas de etiqueta/origem, migração de `deals.tags`, permissões próprias, **correção da RLS de `lead_sources`** | não |
| C2B | executor v3 (`deal.tag_ids`), gravação atômica, **gatilho que cria a inscrição**, carência/reentrada, saída do fluxo quando a paciente responde, tarefa-porteiro | não |
| C2C | seletor de etiqueta no gatilho, **"Adicionar tag" para a secretária**, tela de configuração de categorias | sim |
| C2D | N2 (passos de tarefa e mover etapa/funil) + N4 observabilidade (absorve O2/O3/O4) | sim |

**Não comece nada além da C2A.**

## Leitura obrigatória antes de codar

1. `SPEC-ENTREGA-C.md` **§N1.1 e §N1.2** — o contrato fechado pelo Junior. **Não
   reabrir.**
2. `REVIEW-OPINIAO-ETIQUETAS.md` — a adjudicação do seu próprio parecer. Tudo que
   está em "§3 Onde concordo sem ressalva" é decisão tomada.
3. `PESQUISA-ETIQUETAS.md` — por que GHL e Kommo se prenderam. A causa-raiz deles
   (tag referenciada por **nome**, não por ID) é exatamente o que esta fatia evita.
4. `AGENTS.md` — as regras valem mesmo sem prompt de aprovação.

---

## 1. Taxonomia — as tabelas

Conforme o seu parecer, já adjudicado:

- **`tag_categories`** — UUID, organização, rótulo, nome normalizado,
  **cardinalidade (`single` | `multiple`)**, arquivamento, auditoria. A
  cardinalidade **não muda livremente depois de entrar em uso**.
- **`tags`** — ⚠️ **CORRIGIDO em 2026-07-22 (erro meu, apontado pelo Codex):
  `public.tags` JÁ EXISTE** desde `20251201000000_schema_init.sql:366`, com
  `organization_id` **anulável** e `UNIQUE(name, organization_id)`, e já endurecida
  por `20260612000000_rls_hardening_clinic_pii.sql:48-55`. **Evoluir de forma
  aditiva, preservando `id`/`name`/`color`** — criar tabela paralela produziria
  duas fontes de verdade. Acrescentar: categoria, nome normalizado para dedupe,
  código estável opcional, **`legacy_value` imutável** (ponte com os snapshots v2),
  arquivamento, auditoria. Linhas **sem organização** vão para revisão humana —
  **nunca fabricar tenant**. Detalhes em `REVIEW-PLANO-C2A.md` §1.
- **`deal_tag_assignments`** — negócio, categoria e etiqueta por UUID,
  **`is_primary`**, quando/quem aplicou (**ator tipado**: humano, IA, automação,
  API, importação, migração), quando/quem removeu, e **linha nova** quando a mesma
  etiqueta é reaplicada depois de removida.
- **`automation_tag_dependencies`** — referência por UUID a gatilhos e casos de
  switch, com tipo, automação, draft/versão e `case_id` quando aplicável.

**FKs compostas incluindo `organization_id`** — proteção cross-tenant por chave
estrangeira, não só por RLS. Foi condição sua e eu subscrevo.

**Normalização:** trim, colapso de espaços, Unicode normalizado, minúsculas,
comparação sem acento. Índice único por
`(organization_id, category_id, normalized_name)` **considerando arquivados** —
recriar o nome de uma etiqueta arquivada deve **oferecer restauração**, não gerar
outra identidade. O banco é a autoridade final: duas requisições concorrentes
devolvem **a mesma entidade**, nunca duplicata.

## 2. Migração de `deals.tags` — aditiva, sem fabricar história

Os 7 passos do seu parecer. O ponto que eu destaquei na adjudicação e repito:

> Os dados antigos **não têm data nem autor**. A migração **não pode inventar**
> esses valores a partir de `created_at`/`updated_at` do negócio. Marcar
> `provenance = legacy_migration`, registrar quando foi importado e declarar
> data/autor originais como **desconhecidos**.

É isso que impede o painel do Junior de **mentir sobre março**. Relatórios
temporais devem excluir ou separar o legado.

**Colisão de normalização vai para revisão humana — nunca fundir em silêncio.**

`deals.tags` **permanece** como ponte compatível com snapshots v2. Remover o array
é entrega futura, só quando não houver executor dependente.

## 3. Origem — evoluir `lead_sources`, não duplicar

A tabela já existe (`20260617000000_lead_sources.sql`). Ganha: nome normalizado com
unicidade por organização, código estável, **arquivamento em vez de `delete`**.

**Histórico de atribuição** (tabela nova): negócio/contato, `source_id`, instante
observado, canal, UTM tipado, `fbclid`/`gclid`/referrer/campanha quando existirem,
**proveniência** (automática, API, importação, declaração humana),
`external_event_id`/idempotency key.

**Primeira e última origem** podem ser ponteiros/cache no negócio, mantidos **na
mesma transação** do evento. O histórico é a fonte auditável.

**Nunca um array de origens correntes** — decisão fechada.

**WhatsApp é canal, não origem.** Nunca inferir anúncio só porque entrou por
WhatsApp. Sem evidência: registrar **desconhecida** ou pedir seleção humana com
proveniência manual.

## 4. 🔴 Correção de segurança — a RLS de `lead_sources` (está em produção)

Achado da adjudicação (`REVIEW-OPINIAO-ETIQUETAS.md` §1.2), o mais importante
desta fatia:

`20260617000000_lead_sources.sql:38-44` usa `for all` com
`can_operate_organization`, que inclui **`clinic_staff` e `vendedor`**
(`20260311013000_core_multi_tenant_rls.sql:56-69`). Pela RLS, **a recepção pode
inserir, editar e excluir origem de lead** — contra a decisão explícita do Junior
de que só admin gerencia catálogo.

**Está em `main`**, entre as 34 migrations de produção. Atenuantes que verifiquei:
nenhuma tela chama `leadSources.delete()` e não há FK de negócio para
`lead_sources` — exposição prática baixa, **mas a política está errada**.

**Corrigir nesta fatia:** leitura segue para o tenant; **mutação e exclusão só para
quem administra catálogo**. Remover ou proteger o `delete()` exposto em
`lib/supabase/leadSources.ts:163-175` — arquivar passa a ser o caminho normal.

## 5. Permissões próprias — quatro chaves novas

`automation.operate` **não** governa etiqueta. Criar, no catálogo
(`lib/auth/permissions.ts`) e nos defaults:

- `tags.assign` — usar etiqueta no negócio → **secretária TEM** (é o ponto central
  do pedido do Junior: ela etiqueta, mas não monta automação);
- `tags.manage` — criar, renomear, arquivar categoria/etiqueta;
- `lead_sources.assign` — registrar origem → **secretária TEM**;
- `lead_sources.manage` — administrar o catálogo.

**Quem recebe `*.manage` por padrão** (fechado em `REVIEW-PLANO-C2A.md` §3):
`admin`, `agency_admin`, **`agency_staff`** e `clinic_admin`. **`agency_staff`
entra obrigatoriamente** — ele tem `automation.edit` e, pelo §N1.1, a etiqueta de
serviço nasce **junto com a automação**; sem `tags.manage` ele monta o fluxo e não
consegue criar o próprio gatilho. A decisão do Junior era sobre a **secretária**,
não sobre a agência. `clinic_staff` e `vendedor` recebem apenas `*.assign`.

O snapshot de defaults está em **`active_version = 2`** (confirmei no banco).
Criar a **v3** pelo mesmo mecanismo da C1A (`permission_defaults_state`), mantendo
as versões anteriores imutáveis e o `has_permission` fail-closed.

## 6. O que NÃO fazer nesta fatia

- **Não ligar roteamento.** Nenhuma inscrição automática nova — é C2B.
- **Não tocar em tela.** O gatilho do construtor continua mostrando a fronteira
  `service-tag-entity-v3` — é C2C.
- **Não publicar `schemaVersion: 3`.** O executor v3 é C2B; o whitelist de campos
  do `evaluate_automation_switch` **não muda agora**.
- Não mexer em mídia nem em ciclo de vida de tenant (C3).

## 7. Regras da entrega

- Supabase **local** apenas; nunca `eqidsihasmwwamkaqfka`.
- **Sem push, sem deploy.** `automation_live_enabled = false`,
  `delivery_mode = 'simulation'`.
- **`npm run test:local` verde** (baseline atual: **830/830**) — é o gate real
  agora; `precheck:fast` sozinho ignora a integração local.
- TDD, commits separados por tarefa, `IMPL-LOG-C2A.md` ao final.
- PT-BR.

## 8. Critério de aceite

Como a fatia é invisível, o aceite é por teste, não por tela:

1. criar categoria e etiqueta, e **não conseguir criar duplicata** por
   maiúscula/acento/espaço (`Indicação` = `indicacao` = ` indicação `);
2. **duas requisições concorrentes** de criação devolvem **a mesma entidade**;
3. migração de um `deals.tags` real cria as entidades **sem fabricar data/autor**,
   marcando `legacy_migration`;
4. `clinic_staff` **consegue** aplicar etiqueta e **não consegue** criar, renomear
   ou arquivar categoria/etiqueta;
5. `clinic_staff` **não consegue mais** editar nem excluir `lead_sources`;
6. arquivar etiqueta em uso por automação publicada é **bloqueado com mensagem**
   que diz o que fazer (régua do R7);
7. atribuição cross-tenant é recusada **pela FK**, não só pela RLS.

## 9. Antes de executar

Devolva plano + discordâncias, como nas anteriores. **Se algo aqui conflitar com o
que você mesmo escreveu no parecer, avise** — a adjudicação aceitou o parecer quase
inteiro, então divergência é sinal de erro meu ao transcrever.
