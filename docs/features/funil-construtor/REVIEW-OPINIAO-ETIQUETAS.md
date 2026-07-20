# Adjudicação — parecer do Codex sobre etiquetas (N1.1)

Data: 2026-07-20
Parecer avaliado: `OPINIAO-CODEX-ETIQUETAS.md` (commit `690eece`)
Método: cada alegação técnica conferida no código antes de concordar.

---

## Veredito

**Aceito o parecer.** As quatro correções de premissa procedem — verifiquei todas.
Uma delas é mais séria do que o Codex apresentou (§2 abaixo).

Faço **uma emenda de produto** (§5) e registro **dois pontos de execução** que o
parecer não dimensiona (§6).

---

## 1. Verificação das quatro correções de premissa

### 1.1 "A ordem do `switch` não decide qual automação inicia" — **PROCEDE**

`evaluate_automation_switch` (`20260720010000_funil_c1a_switch_exec.sql:20-43`)
parte de `p_enrollment_id` e faz join com **uma** `automation_versions`. Toda a
precedência por `order` acontece dentro de uma inscrição já existente.

Não há, em nenhuma migration, regra que decida qual automação se inscreve quando
o negócio casa com o gatilho de mais de uma. Eu havia tratado a precedência do
`switch` como resposta parcial ao problema de múltiplos procedimentos, no
`PEDIDO-OPINIAO-ETIQUETAS.md` §4.1. **Estava errado** — são dois problemas em
camadas diferentes. O Codex está certo.

### 1.2 "`automation.operate` não enforça gestão de etiquetas" — **PROCEDE, e é mais grave**

O catálogo de permissões (`lib/auth/permissions.ts:3-49`) **não tem nenhuma chave
de etiqueta ou origem**. Não existe `tags.*` nem `lead_sources.*`. O que a C1A
fechou foi `automation.operate`, que governa a tela de automação — outra coisa.

O buraco concreto, que o parecer menciona de passagem e eu classifico como o
achado mais importante desta rodada:

`20260617000000_lead_sources.sql:38-44` — a policy de mutação é `for all` com
`can_operate_organization`. E `can_operate_organization`
(`20260311013000_core_multi_tenant_rls.sql:56-69`) inclui **`clinic_staff` e
`vendedor`**. Ou seja: pela RLS, a recepção pode inserir, editar **e excluir**
origem de lead. `lib/supabase/leadSources.ts:163-175` expõe `delete()`.

**Isto está em produção.** `lead_sources` faz parte das 34 migrations de `main`.

Dois atenuantes que verifiquei, e que mudam a urgência sem mudar o veredito:

- Nenhuma tela chama `leadSources.delete()` — busquei em `app/` e `components/`
  e não há chamada. O caminho existe na biblioteca, não num botão.
- Não há FK de negócio para `lead_sources`, então excluir uma origem hoje derruba
  a linha do catálogo, não o histórico dos negócios.

Portanto: **falha real de política de acesso, exposição prática baixa, correção
obrigatória na C2** — junto com a origem virando entidade auditada. Não é
incidente para hoje; é dívida que não pode atravessar a C2.

### 1.3 "A corrida se resolve por transação atômica, não por delay" — **PROCEDE**

O executor lê `deal.tags` no **mesmo `select`** que carrega a inscrição
(`20260720010000_funil_c1a_switch_exec.sql:26-43`), dentro da transação do tick.
O Postgres entrega leitura consistente. O modo de falha do GHL só entra aqui se a
C2 gravar etiqueta, evento e inscrição em chamadas separadas.

A sequência de 8 passos do parecer (§12) é o contrato certo. Registro para o
plano: **a API não pode expor "salvar a lista de tags"** — só `add`, `remove`,
`set-primary`. Foi exatamente o `PATCH` que sobrescreve o array inteiro que
quebrou o Kommo (`PESQUISA-ETIQUETAS.md`).

### 1.4 "`lead_sources` já existe" — **PROCEDE**

Uma migration, `20260617000000`. Tem UUID, `organization_id`, `name`, `active`,
`owner_id`, timestamps. Não tem nome normalizado, código estável, arquivamento,
vínculo com negócio, UTM nem histórico. Evoluir, não duplicar. Concordo.

---

## 2. O achado que o parecer traz e que eu não tinha visto

**Semântica temporal** (parecer §12): o `switch` da C1A lê o **estado atual** do
negócio no momento em que executa. Se a etiqueta mudar entre a inscrição e a
execução do passo, o ramo muda junto.

Confirmei no código — o join com `deals` acontece na execução, não há snapshot do
contexto de entrada na inscrição.

Isso não é bug: é decisão de produto que ninguém tomou ainda. As duas semânticas
precisam de nome no builder, senão o Junior vai ver como comportamento errático:

- **decisão congelada na entrada** — "ela entrou por facetas, o fluxo é de facetas
  até o fim";
- **decisão pelo estado atual** — "se ela mudou de ideia no meio, o fluxo
  acompanha".

Minha posição: **congelada na entrada é o padrão** para o gatilho de serviço, que
é o caso da Jéssica. Estado atual fica como opção explícita por passo. Mas isso é
decisão do Junior, não minha.

---

## 3. Onde concordo sem ressalva

- Etiquetas viram entidades com UUID; `deals.tags` deixa de ser fonte de verdade.
- `schemaVersion: 3` com campo `deal.tag_ids` e operador `contains`. Não enfiar
  UUID dentro de `deal.tags` fingindo que ainda é texto.
- Snapshots v2 permanecem imutáveis. Não reescrever versão publicada.
- `caseId` continua identidade do ramo e **não** vira o UUID da etiqueta — ramo e
  etiqueta têm ciclo de vida diferente.
- Migração aditiva em 7 passos, com `provenance = legacy_migration` e **sem
  fabricar data/autor** a partir de `created_at` do negócio. Este cuidado é o que
  impede o painel do Junior de mentir sobre março.
- Colisão de normalização vai para revisão humana; nunca fundir em silêncio.
- Arquivar é o fluxo normal, merge é operação própria, apagar é exceção para
  entidade nunca usada.
- Origem = primeira + última + histórico de toques. Nunca array de origens.
- Permissões próprias: `tags.assign` / `tags.manage` / `lead_sources.assign` /
  `lead_sources.manage`.
- WhatsApp é canal, não origem. Nunca inferir anúncio porque entrou por WhatsApp.

---

## 4. Ordem da fila — mantida

Correção do teste da C1A → **C1B** → C2/etiquetas.

Com a amarração que o Codex define e eu subscrevo: **a C1B não pode consolidar
nenhum seletor novo de gatilho baseado em texto livre de `deals.tags`.** Onde a
tela precisar de etiqueta, ela deixa fronteira substituível pelo seletor de
entidades da C2.

---

## 5. Emenda de produto — o "principal" não pode bloquear a recepção

O parecer (§1) diz: se houver vários procedimentos sem principal e uma operação
precisar iniciar automação, "a interface deve bloquear e explicar".

**Discordo do bloqueio.** A usuária dessa tela é a recepção, no meio do
atendimento, com a paciente esperando. Travar o fluxo para ela resolver uma
disputa de roteamento é o mesmo tipo de erro que a decisão de tirar a automação
da vista dela corrigiu.

Proposta:

- o **primeiro** procedimento aplicado vira principal automaticamente;
- os seguintes entram como interesse, sem disputar roteamento;
- trocar o principal é uma ação de um clique, disponível mas nunca obrigatória;
- o builder mostra qual procedimento é o principal, porque quem monta o fluxo
  precisa saber.

Assim a regra do Codex se mantém — **no máximo um principal, só ele dispara** —
sem nenhum momento em que a tela para e cobra decisão de quem está atendendo.

---

## 6. Dois pontos de execução que o parecer não dimensiona

**6.1 O whitelist de campos é SQL, não configuração.** Adicionar `deal.tag_ids`
exige substituir a função `evaluate_automation_switch` inteira — o whitelist está
literal em `20260720010000_funil_c1a_switch_exec.sql:62`. É migration, com o
executor v2 tendo que continuar funcionando lado a lado. Não é ajuste de
constante.

**6.2 "Um principal, no máximo uma automação publicada ativa"** precisa de
mensagem de erro escrita na publicação, não só constraint. Se o Junior publicar o
segundo fluxo de facetas e receber violação de índice único, ele vai achar que
quebrou. A constraint é certa; a mensagem é parte da entrega.

---

## 7. Nota de medição (erro meu, corrigido)

Escrevi na primeira versão desta adjudicação que o cérebro estava errado ao
registrar "prod = 28 migrations", porque `main` tem 34 arquivos. **Estava
confundindo duas medidas diferentes:** 28 é o número de migrations *aplicadas no
banco de produção*, verificado por MCP na revisão da Entrega B; 34 é o número de
*arquivos* na branch `main`. Não são a mesma coisa e o cérebro não está errado.

Isso não muda a conclusão de §1.2. `20260617000000_lead_sources.sql` é a
**14ª** migration na ordem de `main` — está confortavelmente dentro das 28
aplicadas. A tabela e sua policy estão em produção pelas duas contagens.

---

## Decisões que restam para o Junior

1. **Semântica temporal** (§2): decisão congelada na entrada, ou pelo estado
   atual? Minha recomendação: congelada como padrão.
2. **Emenda do principal automático** (§5): aceita a regra sem tela de bloqueio?

O resto do parecer entra no plano da C2 como está.
