# REVISÃO ADVERSARIAL — PACOTE 3

**Data:** 2026-07-29  
**Base revisada:** `feat/funil-construtor` @ `041d963`  
**Escopo:** remuneração da equipe, comissão por vigência, catálogos, múltiplas
especialidades, vínculos de procedimentos, pagamentos parciais e superfícies de
UI/serviço que escrevem nesses modelos.

## 1. Veredito

**REVISADO, MAS BLOQUEADO PARA SERVIR DE FUNDAÇÃO OU IR A DEPLOY.**

A implementação tem controles importantes corretos e a suíte local passou
`213/213` arquivos e `1011/1011` testes. Isso não basta para aprovar o motor:
há divergência financeira reproduzida entre duas RPCs, pagamento sem
idempotência, relações multitenant sem integridade entre organização e entidade,
histórico mutável e ambiguidades de remuneração que ainda não foram modeladas.

O achado mais grave foi reproduzido no Supabase local: para o mesmo atendimento
e a mesma regra fixa de R$ 50, `get_commission_report` devolveu R$ 50 de comissão
e `get_net_result` devolveu R$ 0. Hoje existem duas fontes de cálculo que
discordam.

Nenhuma correção de código ou migration foi feita nesta revisão. Não houve
acesso ao banco de produção, push, deploy, merge nem `db reset`.

## 2. Método e limites

- Conferência dos 18 commits e das 5 migrations atribuídas ao pacote.
- Comparação do cabeçalho de `get_commission_report` com a versão endurecida do E2.
- Auditoria estática de SQL, RLS, ACL, RPCs, serviços, hooks, UI e testes.
- Aplicação das migrations no Supabase local, sem reset.
- Reproduções SQL dentro de transações revertidas ao final.
- Testes focais: 4 arquivos e 32 testes, todos aprovados.
- Gates completos: `precheck:fast`, `test:local` e `npm audit`.
- Revisão pelos nomes dos controles de segurança: isolamento multitenant,
  autorização no servidor, superfície de RPC, integridade de regras de negócio,
  idempotência, exposição de segredos e segurança de migrations/testes.

Não foram medidos `EXPLAIN`, cardinalidade real de produção ou duração de locks
em volume de produção. A aplicabilidade prática dos avisos de dependência do
`npm audit` também não foi adjudicada neste ciclo.

## 3. As três regressões históricas indicadas no pedido

| Item | Resultado | Evidência |
|---|---|---|
| Cabeçalho da RPC | **PASSOU.** Assinatura, defaults, `RETURNS json`, `STABLE`, `SECURITY DEFINER`, `search_path=''` e gates de organização/permissão equivalem à versão endurecida. A ACL do RPC principal continuou restrita a `postgres` e `authenticated`. | `supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:193-222`; comparação com `supabase/migrations/20260635000000_e2_server_permission_enforcement.sql:499-524` |
| Espelho `amount` × `percent` | **NÃO ESTÁ ENCERRADO.** O remendo cobre o caso em que um lado começa zerado, mas permite dois valores positivos e divergentes; o relatório prefere `amount`. | `supabase/migrations/20260724000000_funcionarios_remuneracao_e_comissao_por_periodo.sql:95-114`; consumo em `supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:272-280` |
| `GRANT` dos catálogos | **A correção funcional passou, mas o hardening está incompleto.** CRUD autenticado funciona e a RLS foi exercitada. Entretanto, ACLs herdadas dão a `anon` `REFERENCES`, `TRIGGER` e `TRUNCATE` nas cinco tabelas novas; logo, “anon ficou de fora” não descreve o estado real do banco. | Grants explícitos em `supabase/migrations/20260724010000_catalogos_cargo_e_especialidade.sql:78-84`; prova pela ACL do PostgreSQL local |

## 4. Achados que bloqueiam o Pacote 3

### P3-01 — CRÍTICO — relatórios calculam comissões diferentes

**Evidência.** O pacote evoluiu somente `get_commission_report`.
`get_net_result` continua com a lógica legada percentual e ignora
`amount_type`, valor fixo de comissão, `valid_from`, procedimento e múltiplas
especialidades.

- Cálculo novo: `supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:272-328`
- Cálculo legado: `supabase/migrations/20260635000000_e2_server_permission_enforcement.sql:623-747`, especialmente `:665` e `:671-684`

**Reprodução local.** Regra fixa de R$ 50 e um atendimento elegível:
`commission_report = 50`; `net_result.commissions = 0`.

**Impacto.** O detalhamento da equipe e o resultado líquido/P&L discordam para
o mesmo período. Uma tela pode afirmar lucro que a outra nega.

**Correção obrigatória.** Criar um resolvedor financeiro canônico interno,
usado pelas duas RPCs, e travar paridade em testes para percentual, valor fixo,
vigência, procedimento e múltiplas especialidades. O resolvedor interno não
deve ampliar a superfície executável pelo cliente.

**Confiança:** alta — `[Behavior observed]`.

### P3-02 — CRÍTICO — pagamento pode ser duplicado por retry, abas ou clique duplo

**Evidência.**

- Retry global de mutation: `lib/query/index.tsx:140-143`
- Mutation de pagamento: `lib/query/hooks/useCommissionPaymentsQuery.ts:31-42`
- `INSERT` simples: `lib/supabase/commissionPayments.ts:120-150`
- Remoção do índice único sem substituto: `supabase/migrations/20260727020000_pagamento_parcial_de_comissao.sql:7-25`

Se o banco confirmar o insert e a resposta HTTP se perder, o retry gera outro
pagamento. Duas abas também leem o mesmo saldo e inserem simultaneamente. Não há
chave idempotente, lock ou validação atômica do valor pendente.

**Impacto.** Comissão quitada em duplicidade ou acima do devido; a UI limita o
saldo visual a zero e pode esconder o excesso.

**Correção obrigatória.** RPC transacional com autorização interna,
`idempotency_key` única, lock da unidade financeira e validação do saldo.
Parcelas legítimas usam chaves diferentes; retries da mesma ação usam a mesma
chave. `retry: false` na mutation deve ser apenas defesa adicional.

**Confiança:** alta — `[Inferred]` a partir do caminho completo; a perda de
resposta não foi simulada.

### P3-03 — ALTO — remuneração fixa e híbrida existe na ficha, mas não no financeiro

**Evidência.** `pay_type` e `fixed_amount` foram adicionados, porém aparecem só
como metadados no relatório.

- Modelo: `supabase/migrations/20260724000000_funcionarios_remuneracao_e_comissao_por_periodo.sql:31-58`
- Relatório final: `supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:235-281`

Um profissional `fixed` de R$ 1.000 sem atendimento continua com total devido
zero. Um profissional `fixed` que possua regra de comissão continua recebendo
essa comissão. Alterar `fixed_amount` hoje também não preserva vigência
histórica.

**Impacto.** A tela promete formas de pagamento que o fechamento não sabe
calcular nem auditar.

**Decisão obrigatória do produto.** Definir competência, rateio e composição de
`fixed`, `commission` e `hybrid`; depois versionar a remuneração e incorporá-la
ao resolvedor canônico e ao resultado líquido. Se esses campos forem apenas
cadastro informativo, a UI precisa dizer isso e não apresentá-los como motor de
remuneração.

**Confiança:** média — `[Inferred]`; a omissão é confirmada, mas a regra correta
exige decisão do Junior.

### P3-04 — ALTO — novas relações permitem referências cruzadas entre organizações

**Evidência.**

- `professional_specialties`: `supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:64-96`
- `specialty_products` e `professional_product_overrides`: `supabase/migrations/20260727010000_procedimento_por_especialidade_e_excecoes.sql:38-105`

As tabelas guardam `organization_id`, mas suas FKs apontam separadamente para os
IDs. A RLS valida a organização da linha filha, não a organização das entidades
referenciadas. Assim, uma linha declarada como organização A pode apontar para
especialidade ou produto da organização B se o UUID for conhecido.

O agravante está em `professional_has_specialty`
(`20260727000000...sql:148-175,311-325`): a relação malformada pode influenciar
o cálculo executado pela RPC `SECURITY DEFINER`.

**Impacto.** Corrupção multitenant e cálculo de A influenciado por catálogo de B.

**Correção obrigatória.** Adotar o padrão já existente em
`20260620000000_fk_cross_org_hardening.sql`: unicidade
`(organization_id, id)` nos pais, FKs compostas nas três relações e
`organization_id` explícita em helpers.

**Confiança:** alta — `[Inferred]` diretamente do DDL, policies e caminho de
chamada.

### P3-05 — ALTO — desativar profissional apaga o histórico do relatório

**Evidência.** O relatório final filtra `p.active = true` em
`supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:291-332`,
com o filtro em `:331`. A versão anterior não fazia isso.

**Reprodução determinística.** Fechar um período, desativar o profissional e
consultar novamente: atendimentos, pagamentos e comissão somem do relatório.
`get_net_result` continua contabilizando fatos do período, ampliando P3-01.

**Impacto.** Fechamento passado mutável e perda de rastreabilidade.

**Correção obrigatória.** Incluir profissionais ativos ou que tenham atendimento
ou pagamento no período. Estado cadastral atual nunca deve apagar fatos
históricos.

**Confiança:** alta — `[Inferred]`.

### P3-06 — ALTO — múltiplas especialidades escolhem regra não relacionada ao procedimento

**Evidência.** O resolvedor considera qualquer especialidade do profissional,
mas não consulta `specialty_products`.

- Resolução: `supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:307-328`
- Vínculo procedimento/especialidade: `supabase/migrations/20260727010000_procedimento_por_especialidade_e_excecoes.sql:31-65`

**Reprodução determinística.** Profissional com especialidades A e B;
procedimento ligado somente a A; regras coringa A=10 e B=30. As duas casam e
vence a mais recente, não a especialidade do procedimento.

**Impacto.** O valor depende da ordem temporal incidental das regras.

**Correção obrigatória.** Resolver primeiro a especialidade do procedimento e
depois a regra; usar IDs estáveis, não nomes. Definir explicitamente a regra
quando um procedimento pertencer a mais de uma especialidade.

**Confiança:** média-alta — `[Inferred]`.

### P3-07 — ALTO — a decisão “nunca editar o passado” não é imposta no banco

**Evidência.**

- Policy mutável preexistente: `supabase/migrations/20260616000000_finance_config.sql:84-101`
- Serviço e hook de update: `lib/supabase/commissionRules.ts:145-168` e `lib/query/hooks/useCommissionRulesQuery.ts:110-148`
- Temporalidade nova: `supabase/migrations/20260724000000_funcionarios_remuneracao_e_comissao_por_periodo.sql:63-123`

**Reprodução local.** Um usuário autenticado e autorizado alterou uma regra
histórica de 10 para 99 via `UPDATE`. A UI nova usa insert, mas RLS, serviço e
hook ainda permitem reescrever a linha.

**Impacto.** O contrato central do pacote depende de disciplina de uma tela e
pode ser quebrado por outro cliente, código legado ou chamada direta.

**Correção obrigatória.** Bloquear update dos atributos financeiros e delete
destrutivo no banco. Mudança normal cria nova versão; correção excepcional
precisa de RPC explícita e trilha de auditoria.

**Confiança:** alta — `[Behavior observed]`.

### P3-08 — ALTO — `amount` e `percent` possuem duas verdades

**Evidência.** O trigger em
`supabase/migrations/20260724000000_funcionarios_remuneracao_e_comissao_por_periodo.sql:95-114`
só sincroniza quando um lado é zero. O relatório em
`20260727000000_especialidades_multiplas_por_funcionario.sql:274-279` prefere
`amount`.

**Reprodução local.** Uma regra com `amount=25` e `percent=10` foi aceita e
permaneceu divergente. Depois, atualizar somente `percent` para 15 manteve
`amount=25`; o cálculo continuou usando 25.

**Impacto.** A UI pode mostrar uma porcentagem e o financeiro usar outra.

**Correção obrigatória.** Uma fonte canônica. Se `percent` continuar por
compatibilidade, aplicar constraint coerente e atualizar o par atomicamente.
Cobrir zero e transições `fixed` ↔ `percent`.

**Confiança:** alta — `[Behavior observed]`.

### P3-09 — ALTO — tenant selecionado não é aplicado de ponta a ponta

**Evidência.**

- Contexto de tenant: `context/TenantContext.tsx:35-49,59-88,104-124`
- Catálogos sem filtro: `lib/supabase/teamCatalogs.ts:38-55`
- Vínculos inferindo organização do perfil: `lib/supabase/specialtyProducts.ts:22-72,109-138`
- Pagamentos por período sem filtro: `lib/supabase/commissionPayments.ts:102-113`
- Query key contém tenant, mas a chamada não o recebe: `lib/query/hooks/useCommissionPaymentsQuery.ts:55-68`

**Condição.** Usuário da agência seleciona A, mas pode acessar A e B. Leituras
misturam dados e escritas inferem a organização do perfil em vez da seleção
ativa. Perfil sem organização própria também pode falhar.

**Impacto.** Operação no tenant errado; P3-04 torna a consequência mais grave.

**Correção obrigatória.** Tornar `organizationId` ativa obrigatória em todas as
assinaturas e filtrar explicitamente cada leitura e escrita.

**Confiança:** alta — `[Inferred]`; o cenário multi-tenant não foi executado na UI.

### P3-10 — ALTO — renomear especialidade reescreve comissões históricas

**Evidência.**

- Rename: `features/settings/components/TeamCatalogManager.tsx:75-80` e `lib/supabase/teamCatalogs.ts:102`
- Regra guarda texto e helper compara nome atual:
  `supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:145-173,307-314`

Regra histórica com `specialty='Ortodontia'` deixa de casar depois de renomear o
catálogo para “Orto”.

**Impacto.** O mesmo período recalculado produz valor diferente.

**Correção obrigatória.** Referenciar `specialty_id` estável. Até a migração,
bloquear rename de nome referenciado ou manter aliases versionados.

**Confiança:** alta — `[Inferred]`.

### P3-11 — ALTO — sincronização de especialidades não é atômica

**Evidência.** `lib/supabase/professionals.ts:120-221,274-371` faz
leitura/delete/insert/reset/update em chamadas separadas. Erros intermediários
em `:154-178` e `:194-205` são ignorados.

**Condição de corrida.** Duas abas leem `[S1]`; A salva `[S1,S2]`, B salva
`[S1,S3]`. O resultado pode ser `[S1,S2,S3]`, solicitado por nenhuma delas, e o
espelho legado pode divergir. Falha de consulta também pode transformar o
conjunto de proteção em vazio e apagar exceções válidas.

**Impacto.** Estado parcial, perda de exceções e decisões que não refletem
nenhuma ação do usuário.

**Correção obrigatória.** RPC transacional com lock, validação same-org,
substituição exata do conjunto e controle de versão/`updated_at` para conflito
entre abas.

**Confiança:** alta — `[Inferred]`.

### P3-12 — ALTO — ações em massa deixam banco e tela divergentes

**Evidência.**

- Estado otimista e writes sequenciais:
  `features/settings/components/SpecialtyProductsPicker.tsx:42-87`
- Chamadores: `features/settings/components/CommissionsManager.tsx:143-196`

Se a terceira escrita falhar, o banco contém só um prefixo das mudanças, mas a
tela já mostra todas. “Restaurar padrão” pode exibir sucesso depois do erro.

**Correção obrigatória.** RPC batch transacional. Se houver retorno parcial por
decisão de produto, reconciliar com refetch canônico e informar exatamente o
que falhou.

**Confiança:** alta — `[Inferred]`.

### P3-13 — ALTO — permissões de leitura e mutação financeira são inconsistentes

**Evidência.**

1. `settings.professionals=true` e `settings.finance=false` ainda monta
   `CommissionsManager`: `features/settings/SettingsPage.tsx:354,409` e
   `features/settings/components/ProfessionalsManager.tsx:457,504`.
2. `reports.professionals` exibe pagar, desfazer e editar data, mas a RLS de
   pagamentos exige configuração da organização:
   `features/reports/ProfessionalsReportPage.tsx:277,301,353,411` e
   `supabase/migrations/20260616000000_finance_config.sql:178-191`.
3. O teste em `features/reports/ProfessionalsReportPage.test.tsx:83-96`
   atualmente consolida o botão para staff.

**Impacto.** Override negativo de Financeiro perde efeito para admin; staff vê
ações que o servidor rejeita.

**Correção obrigatória.** Separar permissão de leitura da permissão de gerenciar
comissões/pagamentos e aplicar a mesma capacidade em UI, rota e RLS/RPC.

**Confiança:** alta — `[Inferred]`.

### P3-14 — CORRIGIDO — defeito latente na data escolhida no pagamento

**Alegação original.** O parecer classificou como reprodução determinística que
`handlePagar` preservaria o valor inicial de `dataPagamento`, enviaria
`paidAt: undefined` e faria o banco usar a data atual.

**Verificação na correção.** A dependência estava realmente ausente:
`handlePagar` lê `dataPagamento` em
`features/reports/ProfessionalsReportPage.tsx:147-181`, mas o valor não constava
nas dependências do `useCallback`. A manifestação operacional descrita, porém,
não era determinística no código vigente. O TanStack Query 5.90.12 devolve um
novo objeto de mutation a cada render, e o mock anterior fazia o mesmo; essa
mudança incidental de identidade recriava a callback com a data atual.

**Classificação corrigida.** **Defeito latente corrigido**, não bug operacional
reproduzido. A closure ficaria obsoleta assim que o hook ou o mock devolvesse um
objeto estável.

**Correção e prova.** `dataPagamento` passou a integrar as dependências de
`handlePagar`. O mock da mutation foi estabilizado e a regressão confere o
`paidAt` ISO exato. Antes da correção, o teste recebeu `undefined`; depois,
recebeu a data escolhida.

**Confiança:** alta — `[Behavior observed]` no teste controlado com identidade
estável; sem alegação de falha observada no runtime real.

### P3-15 — CRÍTICO OPERACIONAL — teste focal pode escrever em produção

**Evidência.**

- `test/financeReportsRpcs.multiTenant.test.ts:34-60` carrega `.env.local` com
  override quando executado isoladamente.
- `test/helpers/supabaseAdmin.ts:37-52` cria cliente administrativo sem validar o
  destino.
- `scripts/test-local.mjs:54-62` força o destino local, por isso a execução via
  `npm run test:local` foi segura.

Neste checkout, `.env.local` aponta para o projeto de produção. Rodar
`npx vitest test/financeReportsRpcs.multiTenant.test.ts` diretamente pode criar
e apagar fixtures reais.

**Correção obrigatória.** O próprio helper deve abortar quando o destino não for
explicitamente local/teste, independentemente do comando chamador. Migrar para
o guard central de destino e adicionar teste de recusa ao project ref proibido.

**Confiança:** alta — `[Behavior observed + análise estática]`. O teste foi
executado nesta revisão somente pelo runner local protegido.

## 5. Outros achados a corrigir ou adjudicar

### P3-16 — MÉDIO — vigência usa pagamento, enquanto o contrato fala em atendimento

O resolvedor usa `a.paid_at` em
`supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:306`.
O atendimento possui `performed_at` em
`supabase/migrations/20260614000000_atendimentos.sql:25-26`.

Atendimento em 14/04, pagamento em 16/04 e regra nova desde 15/04 usa hoje a
regra nova. O teste vigente põe as duas datas iguais e não decide a semântica.
O Junior precisa confirmar a competência; se o contrato permanecer “data do
atendimento”, usar `performed_at` para escolher a regra e `paid_at` apenas para
inclusão financeira no período.

### P3-17 — MÉDIO — regras iguais podem empatar sem desempate total

`supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:322-328`
permite mesmo escopo e mesmo `valid_from`; a ordenação termina em `created_at`,
sem `id`. Duas linhas inseridas na mesma transação podem empatar. Normalizar o
escopo, impedir duplicata lógica e manter `id` como desempate final.

### P3-18 — MÉDIO — desmembramento por vírgula pode destruir nome legítimo

`supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:31-57`
divide todo cargo/especialidade com vírgula e apaga o original se as partes
passarem pela heurística de tamanho. O comentário afirma preservar nome
legítimo, mas o SQL não distingue nome de lista. Usar preflight/mapeamento
revisado dos dados conhecidos, não heurística destrutiva.

### P3-19 — MÉDIO — listagens podem truncar silenciosamente em 1.000 vínculos

`lib/supabase/specialtyProducts.ts:31-46,81-100` carrega todos os vínculos sem
paginação; `supabase/config.toml:15-17` limita a resposta local a 1.000 linhas.
Quatro especialidades com 294 procedimentos já ultrapassam o teto. Paginar
deterministicamente ou devolver o conjunto efetivo por RPC tenant-scoped.

### P3-20 — MÉDIO — “desfazer último” usa data editável, não criação

`lib/supabase/commissionPayments.ts:47-70,102-109` e
`features/reports/ProfessionalsReportPage.tsx:95-106,128-145` ordenam por
`paid_at`. Backfill ou edição da data troca o alvo do undo. Expor `created_at` e
ordenar por criação+ID, ou desfazer a linha explicitamente selecionada.

### P3-21 — MÉDIO — apagar especialidade tem cascata maior do que o aviso

O aviso em `features/settings/SettingsPage.tsx:159` menciona remoção da ficha das
pessoas. As FKs também apagam vínculos de procedimentos
(`supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:68`;
`supabase/migrations/20260727010000_procedimento_por_especialidade_e_excecoes.sql:41`).
Informar impactos e contagens ou preferir arquivamento/bloqueio com dependências.

### P3-22 — MÉDIO — relatórios ficam em cache após mudar insumos

`lib/query/hooks/useCommissionRulesQuery.ts:104-105,144-145,178-179` e
`lib/query/hooks/useProfessionalsQuery.ts:106-108,140-142,174-176` não invalidam
os relatórios financeiros. O valor pode permanecer obsoleto pelo `staleTime`.
Invalidar os roots de comissão e resultado líquido após mudanças relevantes.

### P3-23 — BAIXO — helpers novos mantêm `EXECUTE` implícito para `PUBLIC`

Os helpers de
`supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:148-177`
e
`supabase/migrations/20260727010000_procedimento_por_especialidade_e_excecoes.sql:124-150`
receberam grants explícitos, mas não tiveram o `EXECUTE` padrão revogado de
`PUBLIC`. Fechar a superfície com `REVOKE ALL FROM PUBLIC, anon` e conceder
somente a quem precisa.

### P3-24 — MÉDIO — ACL das tabelas novas é mais larga do que o contrato

A inspeção local, confrontada com os grants em
`supabase/migrations/20260724010000_catalogos_cargo_e_especialidade.sql:78-84`,
`supabase/migrations/20260727000000_especialidades_multiplas_por_funcionario.sql:94-96`
e
`supabase/migrations/20260727010000_procedimento_por_especialidade_e_excecoes.sql:74-111`,
mostrou `anon` com `REFERENCES`, `TRIGGER` e `TRUNCATE` em
`job_roles`, `specialties`, `professional_specialties`, `specialty_products` e
`professional_product_overrides`, herdados de default privileges. A RLS
continua bloqueando CRUD HTTP e PostgREST não expõe `TRUNCATE` cru; portanto não
há prova de exploração remota por esse caminho. Ainda assim, a política de
menor privilégio não está satisfeita. Revogar tudo e conceder o conjunto mínimo
explicitamente.

## 6. Achados adjacentes, não atribuídos como regressão do Pacote 3

Estes pontos devem entrar em backlog próprio e não foram usados sozinhos para
bloquear o pacote:

- Taxas de cartão e custos fixos continuam editáveis in-place e podem recalcular
  o passado (`features/settings/components/CardFeesManager.tsx:137`,
  `features/settings/components/FixedCostsManager.tsx:91,116,124` e
  `supabase/migrations/20260635000000_e2_server_permission_enforcement.sql:705,718`).
- A UI de comissão mostra somente a regra mais recente; o histórico não é
  auditável por um usuário não técnico
  (`features/settings/components/CommissionsManager.tsx:76-78,239,457`).
- Percentual de taxa não aceita vírgula brasileira e descrições automáticas
  podem colidir
  (`features/settings/components/CardFeesManager.tsx:56-61,238,278` e
  `lib/validations/schemas.ts:248`).

## 7. Controles que passaram

- Cabeçalho e gate da RPC principal foram restaurados corretamente.
- `CREATE OR REPLACE FUNCTION` preservou owner e ACL do RPC principal.
- Os `LEFT JOIN` e laterais não inflam contagem sem atendimento:
  `count(a.id)` e `LIMIT 1` evitam linha fantasma.
- Catálogos têm RLS com leitura por acesso à organização e mutação por capacidade
  de configuração.
- O cálculo isolado de “exceção explícita sobre herança da especialidade” está
  correto.
- A UI atual de comissão cria nova regra em vez de chamar update.
- A criação normal espelha `amount` e `percent`.
- Competência `period` e data operacional `paid_at` continuam separadas.
- Financeiro não mostra o CTA de Comissões quando falta acesso a Profissionais.
- Não foi encontrado caller de produção para o antigo campo livre de cargo ou
  especialidade.
- Migrations aplicaram no Supabase local sem reset.

## 8. Evidência dos gates

| Gate | Resultado |
|---|---|
| Testes focais do pacote | **PASSOU:** 4 arquivos, 32 testes |
| `npm run precheck:fast` | **PASSOU:** lint, TypeScript e suite; 213 arquivos / 1011 testes contabilizados, com skips próprios desse runner |
| `npm run test:local` | **PASSOU:** 213/213 arquivos, 1011/1011 testes; saída salva e lida em comando separado |
| `npm audit --audit-level=high` | **FALHOU:** 5 avisos (1 baixo, 4 altos) envolvendo `brace-expansion`, `dompurify`, `next`, `postcss` e `sharp`; sem correção neste ciclo |
| `scripts/verify-rls-live.mjs` | **NÃO EXECUTADO POR SEGURANÇA:** lê `.env.local`, que aponta para produção, e realiza canários de escrita (`INSERT`/`DELETE`) |

O `precheck:fast` também registrou três `ECONNREFUSED` para `localhost:3000` e
mesmo assim saiu com código zero. Não houve falha de teste, mas o ruído reduz a
capacidade do gate de denunciar dependência acidental do dev server.

## 9. Lacunas de teste obrigatórias

Antes de aprovar o motor, adicionar regressões para:

1. paridade `get_commission_report` × `get_net_result`;
2. remuneração percentual, fixa e híbrida;
3. regra histórica imutável;
4. profissional inativo em período passado;
5. `paid_at` diferente de `performed_at`;
6. `amount` diferente de `percent`, zero e troca de tipo;
7. relações same-org e rejeição de FK cruzada;
8. duas especialidades e procedimento ligado a somente uma;
9. idempotência, concorrência, retry e overpay;
10. tenant ativo de usuário de agência;
11. duas abas sincronizando especialidades;
12. falha no N-ésimo item de ação em massa;
13. permissão de leitura sem mutação financeira;
14. payload exato de `paidAt`;
15. recusa fail-closed de qualquer teste contra o project ref de produção;
16. helper/RPC sem execução por `PUBLIC` ou `anon`.

## 10. Ordem recomendada de correção

1. **Segurança do ambiente de teste:** tornar impossível atingir produção por
   execução focal e criar o teste de recusa.
2. **Integridade multitenant:** FKs compostas same-org, tenant ativo explícito e
   ACL/EXECUTE mínimos.
3. **Uma fonte financeira:** adjudicar remuneração fixa/híbrida e competência;
   criar resolvedor canônico usado por relatório e resultado líquido.
4. **Histórico imutável:** versionar remuneração, impedir update/delete de regra,
   usar IDs estáveis e preservar profissional inativo.
5. **Pagamento seguro:** RPC idempotente/transacional com saldo e concorrência.
6. **Escritas compostas:** RPC transacional para especialidades, exceções e
   ações em massa.
7. **Permissões e UI:** separar leitura/mutação, corrigir `paidAt`, histórico,
   avisos de cascata, paginação e invalidação.
8. Reexecutar migrations sem reset, testes de corrida, `precheck:fast`,
   `test:local`, auditoria de dependências e verificação RLS em alvo
   comprovadamente local.

## 11. Proposta de baseline de segurança

Este repositório não possui `scripts/audit-seg.sh`, `status.json` ou equivalente
fail-closed. Proponho um ciclo separado para criar um gate
`audit:security:local` que:

- aborte antes de qualquer scanner/teste se o Supabase não for explicitamente
  local;
- execute `npm audit`, os scanners disponíveis e a bateria RLS local;
- marque erro de ferramenta como falha, não como aprovação;
- produza artefato legível e sem segredos;
- nunca reutilize `verify-rls-live.mjs` enquanto ele estiver acoplado a
  credencial/alvo de produção.

Conforme o escopo aprovado, nenhum script novo foi criado agora.

## 12. Conclusão

O Pacote 3 contém boa evolução de interface e parte relevante da modelagem, mas
o motor ainda não representa uma única verdade financeira nem impõe suas
invariantes no banco. O resultado correto desta revisão é **request changes**:
manter o pacote bloqueado, adjudicar P3-03 e P3-16 com o Junior e corrigir
P3-01 a P3-15 antes de qualquer nova fundação depender dele.
