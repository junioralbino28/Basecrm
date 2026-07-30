# FILA DE REVISÃO PENDENTE (Codex)

> **Por que este arquivo existe.** O Codex bateu o teto semanal e volta **quinta 29/07/2026**.
> Enquanto ele está fora, o Claude continua avançando **só no que é barato de refazer**
> (UI, correções ao vivo, observabilidade de leitura, specs) — nunca fundação nova sobre
> código não-revisado. Cada frente tocada na ausência dele entra aqui como um **pacote fechado**,
> pra que a revisão dele seja **profunda e por partes** (não uma passada rasa gigante) e
> **nada escape**.
>
> **Regra de ouro:** se um pacote encosta em MOTOR (migrations, RPC, jobs, envio), ele é
> marcado 🔴 e **não** vira fundação de outra fatia até o Codex revisar. UI pura é 🟢.
>
> Fluxo por pacote: `PENDENTE` → (Codex revisa dia 29) → `EM REVISÃO` → `REVISADO` (link do parecer).
> Padrão de parecer segue o que já usamos: `PEDIDO-*.md` → `REVIEW-*.md` / `OPINIAO-*.md`.

Última atualização: 2026-07-29 (noite) · branch `feat/funil-construtor` @ `d198139` · baseline `test:local` **1032/1032** (214 arquivos, verde em `d198139`, lido em comando separado)
Base revisada pelo Codex no Pacote 3: `041d963` (baseline daquele momento: 1011/1011 em 213 arquivos).

> **Ordem recomendada (29/07, noite):** **correções do 3** (já revisado e **BLOQUEADO** — `REVIEW-PACOTE-3.md` + `ADJUDICACAO-PACOTE-3.md`) → **7** (motor do webhook) → **10** (spec de papel, barata, destrava construção) → **6** → **1** → **2** → **8** → **9**.
>
> **🔓 30/07: BLOCOS 4 E 5 DESTRAVADOS.** As 2 respostas do Junior chegaram + requisitos novos que entram NA MESMA correção: **`DECISOES-JUNIOR-FINANCEIRO-29-07.md`** (leia antes de tocar no resolvedor). Resumo: regra de comissão escolhida por **`performed_at`** (P3-16) · motor CALCULA fixo/híbrido com versionamento por data e somatório partido (P3-03) · rótulo neutro **"colaborador"** em toda a UI (schema não renomeia) · formas de pagamento viram catálogo criável (spec depois do Pacote 10) · norte = bruto/líquido/margem precisos. **1 pergunta ainda aberta pro Junior** (comissão acrua sem recebimento? crítica pro parcelamento) — não fechar o resolvedor sem ela.

---

## Índice de pacotes

| # | Pacote | Camada | Estado | Parecer |
|---|--------|--------|--------|---------|
| 1 | C2C — Construtor + sincronia + nomenclatura + correções ao vivo | 🟢 UI (+🟡 ponte de dado) | **PENDENTE** | `PEDIDO-REVISAO-C2C.md` (a redigir) |
| 2 | Reforma 2 — canvas vertical + botão de trocar direção | 🟢 UI | **PENDENTE** | a redigir |
| 3 | Remuneração da equipe — cargo/pagamento, comissão por vigência, catálogos, várias especialidades, unificação do cadastro | 🔴 **MOTOR** (5 migrations + reescrita de RPC) | **REVISADO — BLOQUEADO** | [`REVIEW-PACOTE-3.md`](REVIEW-PACOTE-3.md) |
| 4 | C2D — observabilidade de LEITURA (telas "como eu confiro?") | 🟢 UI leitura | _não iniciado_ | — |
| 5 | C2D — motor (create_task / mover etapa real) | 🔴 MOTOR — **spec only** até o Codex | _não iniciado_ | spec a redigir |
| 6 | CSV de totais: leads da tabela viva (`contacts`) | 🟢 leitura (1 lib + 1 teste) | **PENDENTE** | bloco abaixo |
| 7 | WhatsApp ao vivo: notificação de mensagem + 2 bugs reais no caminho (chave velha do QR · webhook esmagava o não-lido) | 🟡 UI + 🔴 **MOTOR** (webhook) | **PENDENTE** | bloco abaixo |
| 8 | Tarde de 28/07: bolinhas âmbar · atendimento no card · reset de especialidade · Agenda NOSSA fatia 1 | 🟢 UI (+🟡 serviço de dado) | **PENDENTE** | bloco abaixo |
| 9 | Agenda: visões de semana e mês + "Todos" com cor por profissional | 🟢 UI pura | **PENDENTE** | bloco abaixo |
| 10 | **Parcelamento clínica — SPEC, nada construído** | 🔴 motor (futuro) | **SPEC A REVISAR** | `SPEC-PARCELAMENTO-CLINICA.md` |

---

## Pacote 1 — C2C: Construtor + sincronia + nomenclatura + correções ao vivo

**Estado:** PENDENTE (aguardando 29/07)
**Modelo:** UI implementada pelo Claude → testada ao vivo pelo Junior (C2C fechada de ponta a ponta) → **falta a revisão adversarial do Codex**.

**Commits (10 de código + 5 de docs), de `2b82356` a `96c2f83`:**

Código a revisar:
- `2b82356` — feedback de ganho + ponte origem (dívida 7c) + `formatBRL` em toda UI + nomenclatura neutra (paciente→lead/contato, "Insights IA")
- `197d0aa` — StaleChunkGuard (auto-reload de aba com chunks obsoletos)
- `bddf3b4` — cleanup das fixtures cobre contatos por NOME (runId) + tabela tasks (fim dos leads-boneco)
- `cf9ea64` — excluir passo no construtor (regras seguras + 6 testes) + confirmação de Publicar + dica Publicar→Testar
- `9996616` — tradutor de erros do motor pra linguagem leiga (`toFriendlyAutomationError`)
- `81044e6` — piso do zoom do mapa 70%→30%
- `a3634c3` — Dividir caminho intuitivo (valor vira lista funil/etapa por nome, dicas por campo)
- `ee3b37c` — construtor ocupa a tela real (flex h-full no lugar de calc chutado)
- `c36322a` — Reforma 1: edição em painel LATERAL direito (fim do dock inferior) + re-enquadrar
- `35ed75a` — menu "agendar rápido" do kanban em portal fixo (coluna não corta mais)

Docs de contexto: `1c56f9d`, `0b89e1d`, `062a7a0`, `eb92725`, `96c2f83`.

**Foco pedido ao Codex:**
1. **Construtor** — a montagem/edição/exclusão de passos, o Dividir caminho (switch), publicação imutável e o disparo do teste em simulação. É onde mais mexemos ao vivo.
2. **Ponte de dado 7c** (`recordAttribution` espelhando nome em `contacts.source`) — é dupla-verdade; validar que não abre inconsistência.
3. **Nomenclatura neutra** — varredura em ~27 telas; conferir que nada quebrou de rótulo/label em teste.
4. Regressões silenciosas nos módulos sem teste (tabela de dívida 9).

**Gates que continuam valendo (não reabrir):** `automation_live_enabled=false`, tudo `simulation`, sem push/deploy, produção intacta.

**Prova atual:** `test:local` = 941/941 · lint `--max-warnings 0` · tsc strict.

---

## Pacote 2 — Reforma 2: canvas vertical + botão de trocar direção

**Estado:** PENDENTE (aguardando 29/07)
**Camada:** 🟢 UI pura — sem migration, sem RPC, sem tocar no motor. Preferência de exibição vive em `localStorage`, não no banco (decisão deliberada: não depender do Codex pra entregar).

**Commits:**
- `89e7ee6` — fatia 1: canvas na vertical (motor de layout agnóstico de eixo)
- `0f5bdea` — fatia 2: botão de trocar direção (vertical↔horizontal) com memória no navegador

**Arquivos-chave:**
- `features/automations/automationTreeLayout.ts` — `layoutAutomationTree` agora exige `orientation`; projeção main/cross + `edgeGeometry` por eixo
- `features/automations/automationTreeLayout.test.ts` — 6 testes (3 horizontais originais preservados + 3 espelho vertical)
- `features/automations/AutomationFlowMap.tsx` — props `orientation` / `onToggleOrientation`; botão no controle do mapa
- `features/automations/AutomationBuilderPage.tsx` — estado + `localStorage['basecrm.automation.builder.orientation']`; `fitKey` inclui a orientação

**O que o Junior conferiu ao vivo:** abriu o construtor, viu o fluxo descendo na vertical, clicou no botão do canto e o mapa virou pro horizontal intacto; refresh reabre na última direção escolhida.

**O que pedir ao Codex (foco adversarial):**
1. **Equivalência dos eixos** — o horizontal saiu byte-a-byte equivalente ao anterior? O algoritmo girado não introduziu regressão em fluxo profundo/ramificado?
2. **Hidratação da preferência** — o `ref` anti-sobrescrita cobre todos os caminhos (SSR, primeiro render, troca de automação)? Há risco de gravar `vertical` por cima da escolha do usuário?
3. **Reenquadramento** — `fitKey` com a orientação embutida re-encaixa sempre, ou existe caso em que o mapa fica fora de vista?
4. Acessibilidade do botão (rótulo = destino) e comportamento quando `onToggleOrientation` não é passado.

**Encosta em motor?** Não.
**Prova:** `test:local features/automations` = 62/62 · `typecheck` (tsc strict) limpo · `eslint --max-warnings 0` limpo.

---

## Pacote 3 — Remuneração da equipe: cargo/pagamento, comissão por vigência, catálogos

**Estado:** REVISADO · **BLOQUEADO PARA FUNDAÇÃO/DEPLOY** · parecer:
[`REVIEW-PACOTE-3.md`](REVIEW-PACOTE-3.md)
**Camada:** 🔴 **MOTOR** — 5 migrations novas, reescrita de uma RPC `SECURITY DEFINER` e mudança de contrato de tabela existente. É o pacote mais perigoso da semana; é também o que **não deve virar fundação** de nenhuma fatia nova antes do parecer.

**Por que existe:** o Junior autorizou explicitamente avançar em motor na ausência do Codex ("tudo que puder fazer agora, faz, e cria documentação pro Codex só revisar"). A regra que dirige o desenho: a planilha do Adel é caso de uso pra aprender a **regra**, nunca a fonte dos **valores** — nada de odontologia nem número de cliente entra no motor, porque o CRM serve outros nichos.

**Commits (18 de código, `7e5d5a5` → `96421a0`):**

| SHA | O que faz |
|---|---|
| `7e5d5a5` | migration: `professionals` ganha `role`/`pay_type`/`fixed_amount`; `commission_rules` ganha `amount_type`/`amount`/`procedimento`/`valid_from`; **reescrita de `get_commission_report`** |
| `c5e405f` | 🚨 correção de segurança — restaura o gate original da RPC (ver "erro 1" abaixo) |
| `2d6f285` | tela de funcionário: cargo + forma de pagamento, lista agrupada por cargo |
| `0bee7e1` | tela de comissão: valor fixo **ou** percentual, escopo por procedimento, e alterar **cria período novo** |
| `508944c` | Planilhas vira aba de topo (saiu de dentro de Financeiro) e comissão puxa procedimento do catálogo |
| `2619583` | comissão vira **mestre-detalhe** (escolhe a pessoa → vê a tabela dela), referência: API do Clinicorp |
| `a09172c` | migration: `job_roles` + `specialties` — cargo e especialidade viram lista configurável |
| `40e455d` | 🚨 correção de segurança — `GRANT` faltando nas duas tabelas novas (ver "erro 3") |
| `970429f` | **comissão migra pra dentro da ficha da pessoa** (`CommissionsManager` em modo embutido; Financeiro vira só o caminho) |
| `174f81f` | 🚨 guarda de permissão — quem tem Financeiro sem Profissionais recebe instrução, não botão que nega |
| `5998f5e` | **procedimento por especialidade + o que cada pessoa faz** (derivado + exceções; migration `20260727010000`) |
| `dbf760e` | chave "Faz" movida pra direita da tabela (pedido na tela) |
| `48eab4f` | **marcar/desmarcar todos + restaurar padrão** nos 3 lugares com chave; **especialidade que ENTRA apaga as exceções dos procedimentos dela** |
| `562e9b0` | comissão vira parte do **dashboard do Financeiro** (sai do menu) + **pagamento parcial e desfazer**; migration `20260727020000` **derruba o índice único** de pagamento |
| `fbf4769` | valor e data de cada pagamento na coluna "Paga" |
| `bfaf415` | **data do pagamento editável** (só `paid_at`; competência não muda; grava ao meio-dia local) |
| `96421a0` | **digitação de dinheiro no padrão BR** (máscara de caixa) + descrição da taxa deixa de ser obrigatória |
| `87f7029` | **várias especialidades por funcionário** (`professional_specialties`) + desmembra as entradas coladas do catálogo + coringa da comissão casa com qualquer especialidade |

Docs de contexto (decodificação das planilhas do Adel): `f20f9a1`, `0f8cf9d`, `f167bea` → `docs/MAPA-PLANILHAS-JESSICA.md`.

**Arquivos-chave:**
- `supabase/migrations/20260724000000_funcionarios_remuneracao_e_comissao_por_periodo.sql`
- `supabase/migrations/20260724010000_catalogos_cargo_e_especialidade.sql`
- `lib/supabase/teamCatalogs.ts` · `lib/supabase/commissionRules.ts` · `lib/supabase/professionals.ts`
- `features/settings/components/CommissionsManager.tsx` (reescrita) · `ProfessionalsManager.tsx` · `TeamCatalogManager.tsx` · `SettingsPage.tsx`
- `test/teamCatalogs.local.test.ts` (novo, 4 testes reais autenticados) · `test/financeReportsRpcs.multiTenant.test.ts` (2 atualizados + 2 novos)

**Decisão travada (não reabrir):** comissão **nunca** é editada por cima. Alterar hoje cria um período novo que vale de hoje em diante, até alterar de novo, **sem data de fim** (o Junior recusou vigência com prazo). Cada atendimento usa a regra válida **na data dele** — o passado nunca é reescrito. Provado em teste: dois atendimentos iguais em 10/04 e 20/04, regra R$ 30 + adendo R$ 50 a partir de 15/04 → abril soma **80**, não 100.

**O que o Junior conferiu ao vivo:** cadastrou funcionário escolhendo cargo e forma de pagamento; abriu Comissões, escolheu a pessoa e viu a tabela `Procedimento | Valor | Comissão`; criou cargo e especialidade nas abas novas (foi aqui que o `permission denied` apareceu, e foi corrigido).

### 🚨 Três defeitos MEUS neste pacote — comece a revisão por eles

O Codex deve tratar estes como **prova de que a área é escorregadia**, não como assunto encerrado:

1. **Cabeçalho de segurança perdido em silêncio** (corrigido em `c5e405f`). Ao reescrever `get_commission_report` a partir do corpo, troquei `SECURITY DEFINER`→invoker, `SET search_path = ''`→`public`, perdi `STABLE` e troquei o gate `can_access_organization + has_permission('reports.professionals')` por `can_configure_organization`. Efeito: `clinic_staff` **com** a permissão liberada passaria a levar 42501 — arrombando o modelo de permissão granular do E2. Quem pegou: `test/e2ServerIsolation.local.test.ts`, só na **suíte completa** (o arquivo da própria feature deu 10/10 e não acusou nada).
2. **Coluna nova sem espelho do par legado.** Criei `commission_rules.amount`, mas a tela existente gravava só `percent` → toda regra criada pela tela sairia com comissão **zero**. Remendado com o gatilho `sync_commission_rule_amount` + fallback `coalesce(nullif(regra.amount,0), regra.percent, 0)`.
3. **`GRANT` esquecido** (corrigido em `40e455d`). RLS só **restringe**; sem grant o Postgres nega antes de olhar a policy. As duas abas novas nasceram mortas. Quem pegou: o Junior, na tela.

### O que pedir ao Codex (foco adversarial)

**Na RPC `get_commission_report`:**
1. **Cabeçalho de segurança** — conferir campo a campo contra a versão de `20260635000000_e2_server_permission_enforcement.sql`. Sobrou alguma diferença além das que restaurei?
2. **Precedência da regra** — a ordenação (pessoa+procedimento > pessoa+especialidade > pessoa > coringa por especialidade > `valid_from DESC` > `created_at DESC`) resolve todo empate? Existe combinação em que duas regras diferentes empatam e o resultado vira não-determinístico?
3. **Duplo remendo do percentual** — gatilho **e** `coalesce` no cálculo. Há caso em que os dois discordam? Ex.: `amount_type='percent'` com `amount` e `percent` ambos > 0 e **diferentes** (o gatilho não sincroniza; o cálculo prefere `amount`). E o que acontece ao mudar uma regra de `fixed` de volta pra `percent`?
4. **`LEFT JOIN` + `LATERAL`** — quem não produziu aparece zerado, mas conferir que o `LATERAL` com `a.paid_at` nulo não gera linha fantasma nem infla `atendimentos` (`count(a.id)` é proposital).
5. **Fuso** — o corte usa `AT TIME ZONE 'America/Sao_Paulo'` na comparação com `valid_from`, mas o range do período vem em `timestamptz`. Atendimento pago perto da virada do dia cai no período certo?
6. **Sem restrição de unicidade em `commission_rules`** — nada impede dois períodos idênticos (mesmo escopo, mesmo `valid_from`). Isso é aceitável ou precisa de índice? A tela lista/esconde os períodos antigos de forma compreensível pra um leigo?

**Nas várias especialidades por funcionário (`20260727000000`, commit `87f7029`):**
- **Desmembramento das entradas coladas** — a migration quebra `name` que contém vírgula em várias entradas e apaga a original. Existe nome legítimo de cargo/especialidade com vírgula que seria destruído? A guarda hoje é "toda parte tem ≥ 2 caracteres"; é suficiente?
- **Espelho legado** — `professionals.specialty` agora guarda a **primeira em ordem alfabética**. Algum leitor da coluna antiga assume que ela é *a* especialidade da pessoa e passa a mostrar/decidir errado?
- **`professional_has_specialty`** — é `SECURITY INVOKER` chamada de dentro de uma `SECURITY DEFINER`. Isso vaza leitura de outra clínica em algum caminho? O fallback "se a pessoa não tem nenhuma ligação, olha a coluna antiga" pode mascarar uma ligação perdida?
- **Custo** — a função é chamada 3× por linha do `LATERAL` (2 no `WHERE`, 1 no `ORDER BY`). Numa clínica com muitos atendimentos isso vira problema de desempenho?
- **`ON DELETE CASCADE` em `specialty_id`** — apagar uma especialidade do catálogo remove a marcação de todo mundo. A tela avisa isso em linguagem de leigo; é o comportamento desejado ou deveria bloquear a exclusão quando há gente marcada?
- **Sincronização apaga e reinsere** (`syncSpecialties`) — não é transacional. Se o insert falhar depois do delete, a pessoa fica **sem nenhuma** especialidade. Vale mover pra uma RPC transacional?

**Na unificação do cadastro (`970429f`, `174f81f`, `5998f5e`) — MOTOR na terceira:**
- **Derivado + exceções** (`professional_does_product`): a exceção manda; sem exceção, vale a especialidade. O serviço **apaga** a exceção quando a escolha volta a coincidir com o padrão — há caminho em que isso perde uma escolha deliberada do usuário?
- **Custo**: a tela da ficha carrega TODOS os vínculos da clínica (`specialty_products.list()`) e filtra no cliente. Com 294 procedimentos × N especialidades isso escala?
- **Otimismo na marcação** (`SpecialtyProductsPicker`): o estado muda antes da resposta e desfaz no erro. Dois cliques rápidos no mesmo item podem gravar o inverso?
- **Separação comissão × "faz"**: são deliberadamente independentes. Isso deixa buraco (pessoa com comissão num procedimento que ela não faz) que valha barrar?
- **Reset ao recolocar a especialidade** (`syncSpecialties`): entrar apaga as exceções dos procedimentos daquela especialidade; sair não apaga nada. Assimetria deliberada — ela surpreende em algum caminho? E a leitura-antes-de-escrever abriu janela de corrida se duas abas salvarem a mesma pessoa?
- **Ações em massa**: gravam item a item, em série, só no que muda. Se falhar no meio, o estado da tela fica adiantado em relação ao banco — vale transação/RPC?
- **Índice único derrubado** (`20260727020000`): a trava anti-clique-duplo passou a viver só no botão. Isso basta? Duas abas abertas gravam dois pagamentos iguais sem nada barrar.
- **`paid_at` editável sem mexer em `period`**: assimetria deliberada. Existe relatório que ordena/filtra por `paid_at` e passa a divergir da competência?
- **Máscara de dinheiro**: aplicada em R$ e NÃO em %. Sobrou algum campo monetário sem ela, ou algum percentual com ela?
- **Descrição da taxa opcional**: o nome automático ("Crédito · Visa · 3x") pode colidir/duplicar entre taxas diferentes?
- **A comissão sumiu do Financeiro** — conferir que nenhum outro caminho/permissão dependia de editar comissão por lá.

**Nas migrations:**
7. **Idempotência e ordem** — `ADD COLUMN IF NOT EXISTS` + `DO $$` checando `pg_constraint`: roda duas vezes sem quebrar? Roda numa base que **já tem** dados de produção sem travar tabela por tempo demais?
8. **`DEFAULT 'commission'` em `pay_type` e `valid_from DEFAULT 1900-01-01`** — os defaults escolhidos para as linhas legadas mudam o resultado de algum relatório já emitido?
9. **`job_roles`/`specialties`** — RLS + GRANT conferidos contra uma tabela irmã que já funciona (`lead_sources`); o `anon` ficou de fora **de propósito**.

**Na UI:**
10. **`CommissionsManager.salvar()` chama sempre `createMutation`, nunca update** — é a materialização da decisão de vigência. Confirmar que não existe caminho na tela que ainda faça `update` numa regra antiga (seria reescrever o passado).
11. Cargo e especialidade agora são `<select>` dos catálogos — sobrou algum ponto de **texto livre** que volte a permitir "Ortodontia" × "ortodontia"?

**Encosta em motor?** **Sim.** Nenhuma fatia nova se apoia neste pacote até o parecer.
**Prova:** `test:local` = **991/991** (209 arquivos, verde em `61f1cfa` — 28/07) · `eslint --max-warnings 0` limpo · `tsc` strict limpo.
**Pendência conhecida (não é bug deste pacote):** `lib/reports/summaryCsv.ts:33-41` conta leads da **tabela morta `leads`** — mostraria "Leads: 0" pra sempre pra quem linkar o CSV no Excel. Conferido no banco local em 28/07: **`leads` = 0 linhas, `contacts` = 143**.
**⚠️ Agravante achado em 28/07 — vale como foco de revisão por si só:** o teste que cobre esse CSV (`test/n7Reports.multiTenant.test.ts:111-112`) **insere linhas na tabela morta** só pra o total não dar zero. Ou seja, **o teste sustenta o erro em vez de pegá-lo** — mesmo padrão de "expectativa velha" que já mordeu duas vezes esta semana. Fora esses dois arquivos e `test/rlsHardening.crossTenant.test.ts`, **nenhum outro ponto do código toca em `leads`**. Correção proposta ao Junior (apontar pra `contacts` + reescrever o teste pra provar o número certo) — **fora do motor**, ainda **não executada**.
**Decisão em aberto pro Junior:** profissional com **várias especialidades** (a Jéssica tem 4; o cadastro aceita uma). Ou escolhe a principal, ou vira tabela de ligação + seleção múltipla — e aí mexe de novo na precedência da regra.

---

## Pacote 6 — CSV de totais: leads contados da tabela viva

**Estado:** PENDENTE
**Camada:** 🟢 leitura — 1 função de lib + 1 arquivo de teste; sem migration, sem RPC.
**Commits:** `8512dca`
**Arquivos-chave:** `lib/reports/summaryCsv.ts` · `test/n7Reports.multiTenant.test.ts`
**O que era:** o CSV público de totais (planilha conectada via `=IMPORTDATA`) contava leads da tabela **legada `leads`** (0 linhas) em vez de `contacts` (onde todo lead entra) — mostraria "Leads: 0" pra sempre. Agravante: o teste **inseria linhas na tabela morta** só pra contagem não dar zero — sustentava o bug em vez de pegá-lo.
**O que o Junior aprovou:** correção direta ("pode fazer a correção"), critério = CSV mostra contagem real de contatos + suíte completa verde.
**O que pedir ao Codex (foco adversarial):**
1. `contacts` é mesmo a fonte única de lead? Existe fluxo que cria lead SEM linha em `contacts` (importação, webhook, IA) que agora ficaria de fora da contagem?
2. O CSV é público-por-token e conta TODOS os contatos da org — inclui gente que não é "lead" (ex.: contato já paciente)? O rótulo "Leads" continua honesto ou deveria filtrar por estágio/etiqueta?
3. A tabela `leads` segue existindo com RLS testada em `rlsHardening.crossTenant.test.ts` — vale marcar pra remoção formal (migration de drop) ou mantê-la?
**Encosta em motor?** Não.
**Prova:** `test:local` = **991/991 (209 arquivos)** verde após a mudança (2ª confirmação do baseline no dia).

---

## Pacote 7 — WhatsApp ao vivo: notificação de mensagem + 2 bugs reais

**Estado:** PENDENTE
**Camada:** 🟡 UI (semáforo + badge + notificação) e 🔴 **MOTOR** no último commit (webhook de recebimento).
**Contexto:** 28/07 o número da IA foi CONECTADO de verdade (Evolution, produção da Jéssica) e o uso ao vivo do Junior/Adel expôs bugs que nenhum teste pegava.
**Commits:** `1724793` · `ec51965` · `61b582a` · `576c2b7` · `35b1ef8`

| SHA | O que faz |
|---|---|
| `1724793` | 🐛 "Reparear" caía em "Forbidden": o parser de erro da Evolution só aceitava motivo string (o real vem em LISTA) e o regex do fallback "já existe→busca QR" exigia a palavra "instance" que a frase real não tem |
| `ec51965` | semáforo de conexão (verde/âmbar/vermelho) + a tela confere o status sozinha (healthcheck no mount e a cada 60s) |
| `61b582a` | não-vistas no menu (badge) + notificação do sistema estilo WhatsApp + som + toggles por usuário. ⚠️ **subiu com 4 testes quebrados e mensagem afirmando verde** — leitura da suíte e commit estavam encadeados num comando só (erro de processo, regra nova adotada) |
| `576c2b7` | correção do arnês: `Layout.permissions.test` neutraliza o módulo novo (QueryClientProvider) |
| `35b1ef8` | 🔴 **MOTOR** — 🐛 bug ANTIGO: no ramo `inbound && ai_active` do webhook, um update redundante reconstruía a metadata da foto lida ANTES do incremento e **esmagava o `unreadCount` com 0** milissegundos depois. Não-lidas NUNCA acumularam em conversa com IA ativa. Fix = remover o bloco (campos todos já gravados pelo update anterior) |
| `e48e45b` | menu do avatar mostra a permissão REAL do navegador (4 estados; toggle "ativo" com permissão `default` passa a PEDIR a permissão no clique — era o motivo da janela nunca subir) |
| `e602be4` | bolinhas âmbar de pendência em "Hoje" (ligações vencidas+hoje) e "Tarefas" (prazo hoje) — mesmo NavItem badge, tom âmbar |
| `61c5e00` | 🐛 correção de teste ao vivo: a bolinha conta **MENSAGENS** (não conversas) e **abrir a conversa marca como lida sozinha** (efeito auto `mark_as_read` + invalidação imediata do resumo) — antes só o botão manual derrubava o contador |

**O que pedir ao Codex (foco adversarial):**
1. **A remoção do bloco no webhook é segura?** Conferir campo a campo que o update anterior grava TUDO que o bloco removido gravava, em todos os caminhos (thread nova × existente; `resolved` reaberto). Existe algum caminho onde o bloco era a única gravação?
2. **Corrida restante:** o marcador do debounce (spread da leitura fresca) ainda pode perder um incremento se DUAS mensagens chegarem no intervalo entre a leitura e o update? Vale mover o incremento pra SQL atômico (`jsonb_set` com coalesce) em vez de read-modify-write?
3. **`processDeferredAIReply`** zera `unreadCount` ao responder — com a IA DESLIGADA (flag off), confirmar que nenhum caminho desse fluxo ainda toca a metadata.
4. **Poll de 30s da tela** (`useConversasNaoLidas`): a rota devolve a lista INTEIRA de threads — numa clínica com centenas de conversas isso escala? Vale endpoint só de resumo?
5. **Duas threads pro MESMO contato** apareceram em produção (16h24 e 16h56, mesmo telefone) — o webhook deveria ter reutilizado a primeira? Investigar o matching de thread por telefone.
6. Parser de erro da Evolution: a reordenação (motivo detalhado > rótulo) muda alguma mensagem exibida em outro fluxo (envio, desconexão)?

**Foco adversarial adicional (commits `e48e45b`/`e602be4`/`61c5e00`):**
7. **Auto marcar-lida** (`61c5e00`): o efeito dispara quando a thread selecionada tem `unread_count>0` — o `marcandoLidaRef` anti-rajada cobre o caso de mensagem NOVA chegando com a conversa aberta (o contador sobe e o efeito re-dispara)? Alguma corrida entre o PATCH e o poll de 30s reexibe a bolinha por um ciclo?
8. **Contagem por MENSAGENS** (`totalMensagens`): consistente com o que o webhook incrementa? Thread com `unreadCount` corrompido/negativo quebra a soma?
9. **Bolinhas âmbar**: `buildCallList` e `splitTasks` rodam no Layout a cada render de menu — custo aceitável? A data "hoje" usa fuso local do navegador; virada de dia com aba aberta atualiza?

**Encosta em motor?** **Sim** (`35b1ef8`, webhook). Nenhuma fatia nova se apoia nele até o parecer.
**Prova:** `test:local` = **1011/1011 (213 arquivos)** verde em `5624e5e` · lint `--max-warnings 0` · tsc strict. Fixado ao vivo: instância `open`, "oi" do Junior dentro do CRM, IA muda (flag `ai_conversation_auto_reply=false` gravada explícita — o default do código "ausente/erro = LIGADO" em `lib/ai/features/server.ts` é candidato a G24).

---

## Pacote 8 — Tarde de 28/07: âmbar no menu · atendimento no card · reset de especialidade · Agenda NOSSA fatia 1

**Estado:** PENDENTE
**Camada:** 🟢 UI (+🟡 serviço de dado — `appointmentsLocal` e `syncSpecialties` gravam via cliente user-scoped; RLS existente decide; **zero migration, zero RPC nova**)
**Commits:** `4479366` · `a961fa6` · `5624e5e` (os 3 de notificação foram anexados ao Pacote 7)

| SHA | O que faz |
|---|---|
| `4479366` | **especialidade removida leva embora as marcações DELA**: `syncSpecialties` na SAÍDA apaga overrides dos procedimentos da especialidade que saiu, EXCETO os cobertos por especialidade que ficou (simétrico ao reset de entrada já revisável no Pacote 3) |
| `a961fa6` | **Registrar atendimento direto do card do lead**: `RegistrarAtendimentoDoLead` reusa `useAtendimentosController` + `AtendimentoFormModal` com o lead travado (`dealsDoLead` filtrado) |
| `5624e5e` | **Agenda NOSSA fatia 1**: grade do dia por dentista (padrão Clinicorp), 08:00–18:30 de 30 em 30; CRUD local (`appointmentsLocal.ts`: criar `source:'manual'`/`status:'agendado'`, remarcar carimba `remarcado`, mudar status); 60min ocupa 2 linhas; cancelada libera a vaga; rótulo "veio do Clinicorp" pra `source:'clinicorp_api'` (fatia 3). **Apagou** a UI antiga dirigida por Clinicorp (`useAgendaController`/`AgendaDayView`/`AgendaBookModal`); rotas `app/api/agenda/*` mantidas pras fatias 2/3 |

**O que o Junior conferiu ao vivo (29/07):** grade com os 7 dentistas, marcar/remarcar/cancelar/status funcionando; aprovou. Único defeito achado foi de DADO, não de código (ver nota de semeadura abaixo).

**O que pedir ao Codex (foco adversarial):**
1. **`appointmentsLocal` grava via cliente do usuário** — a RLS de `appointments` cobre select (`can_access_organization`) e mutação (`can_operate_organization`)? Conferir contra o achado seu anterior de **grants largos demais do `anon` em `appointments` (até TRUNCATE)** — este pacote torna o achado urgente.
2. **Fuso**: `paraIsoLocal`/`horaLocalDe` convertem local↔ISO no navegador — consulta marcada às 08:00 em máquina com outro fuso aparece na linha certa pra quem está no fuso da clínica?
3. **Sobreposição não é barrada**: nada impede 2 consultas no mesmo dentista/horário (a grade só mostra a 1ª por vaga?). Aceitável na fatia 1 ou precisa de guarda já?
4. **`linhasOcupadas`/`ocupadasPorContinuacao`**: consulta de 90/120min ocupa todas as linhas? `ends_at` nulo cai como 30min?
5. **Reset de especialidade na saída** (`4479366`): o `cobertos` (produtos ainda cobertos pelas especialidades que ficam) está correto quando a MESMA pessoa sai de A e entra em B no mesmo salvamento? Ordem de execução importa?
6. **`RegistrarAtendimentoDoLead`**: o `chegouAbrir` ref sincroniza fechar-controller→fechar-card em todos os caminhos (salvar, cancelar, X)? Duplo clique no botão abre 2 modais?

**Encosta em motor?** Não (serviços gravam pelo cliente autenticado; policies existentes decidem). A parte de MOTOR da agenda (espelho ida/volta Clinicorp, permissão do dentista) são as fatias 2/3/4 — **spec só depois do parecer deste pacote e do 3**.
**Prova:** `test:local` = **1011/1011 (213 arquivos)** verde em `5624e5e` (lido ANTES do commit) · lint `--max-warnings 0` · tsc strict · deploy READY.

---

## Pacote 9 — Agenda: semana, mês e visão "Todos" com cor por profissional

**Estado:** PENDENTE
**Camada:** 🟢 UI pura — sem migration, sem RPC, sem tocar no serviço. Mesma consulta da fatia 1 com a janela de datas maior (`appointmentsLocal.listar` já recebia intervalo); o filtro por profissional é client-side de propósito, pra não ampliar superfície.
**Commits:** `05a9fed` (semana e mês por profissional) · `d198139` (visão "Todos" + cor por profissional)

**O que o Junior conferiu ao vivo:** testou a 1ª entrega ("ficou bom") e pediu a visão "Todos" — a atendente precisa enxergar os dentistas juntos pra fazer encaixe sem abrir agenda por agenda — mais cor por profissional.

**Decisões de desenho a validar:**
- Semana começa na **segunda** e mostra **os 7 dias, incluindo domingo** (consulta de domingo não pode sumir da tela).
- A cor identifica **QUEM** (faixa lateral na semana, nome colorido no mês, legenda ligando cor→nome); o **fundo do cartão continua sendo a SITUAÇÃO**. Duas informações, dois canais.
- Cor deriva do **hash do `id`**, não da posição na lista — cadastrar dentista novo não embaralha a cor dos outros.
- A conta de ocupação vive **só na grade**; a página recebe `livres` prontos em vez de recalcular.

**O que pedir ao Codex (foco adversarial):**
1. **Fuso:** `diaLocalDe`/`paraIsoLocal`/`horaLocalDe` convertem no navegador. Consulta às 23:30 cai no dia certo? E numa máquina em fuso diferente do da clínica?
2. **Volume:** o mês busca a org inteira e filtra no cliente. Clínica cheia (7 dentistas × 30 dias) devolve quanto? Vale filtrar no serviço?
3. **Sobreposição** continua não barrada (herdado da fatia 1) — na visão "Todos" isso fica mais visível; vale guarda agora?
4. **`livres` calculado na grade** cobre o caso de a consulta ter `professionalId` nulo? E consulta de 90/120 min bloqueando as vagas seguintes de um só dentista?
5. **Colisão de cor:** paleta de 8 com hash — clínica com 9+ profissionais terá duas pessoas na mesma cor. A legenda salva a leitura ou precisa de paleta maior?
6. Acessibilidade: a cor é o único canal pra "quem"? (Hoje não — o nome vem escrito junto.)

**Encosta em motor?** Não.
**Prova:** `test:local` **1032/1032 (214 arquivos)** verde em `d198139`, lida em comando separado antes do commit · lint `--max-warnings 0` · tsc strict · deploy READY.

---

## Pacote 10 — Parcelamento clínica (SPEC, nada construído)

**Estado:** SPEC A REVISAR — **nenhuma linha de código, nenhuma migration**
**Documento:** `docs/SPEC-PARCELAMENTO-CLINICA.md`
**Camada:** 🔴 motor quando for construído (2 tabelas + RPCs + regra de dinheiro)

**Por que revisar antes de construir:** é dinheiro e é motor. A spec **já nasce aplicando os
achados do seu Pacote 3** — FK composta same-org (P3-04), GRANT explícito + REVOKE de
`anon`/`PUBLIC` (P3-24), baixa como RPC idempotente (P3-02), criação transacional (P3-11/12),
histórico não reescrito (P3-07). Quero que você ataque a spec **antes** de ela virar código.

**Foco pedido:**
1. O modelo de 2 tabelas (`installment_plans` / `plan_installments`) resolve o caso, ou falta entidade?
2. `due_date` (data combinada) e `remind_at` (data do cutucão) separados é a modelagem certa pra "reagendar ≠ postergar"?
3. Baixa **parcial** com `paid_amount` na própria parcela — abre buraco de conciliação?
4. Gerar N tarefas no ato (uma por parcela) é melhor ou pior que derivar o lembrete na leitura? Parcelamento de 24x cria 24 tarefas.
5. Idempotência: a chave proposta cobre parcela paga em duas vezes no mesmo dia (dois recebimentos legítimos e iguais)?
6. Algum gate G1–G25 que a spec ainda não endereça?

**Encosta em motor?** Ainda não — é papel. **Construção só depois:** dos seus 2 primeiros blocos de correção do Pacote 3 e do seu parecer sobre esta spec.

---

## 📌 Nota de operação — 29/07: conserto de acentuação na produção (SEM código)

A semeadura local→prod de 28/07 gravou texto com codificação trocada (UTF-8 lido como Win1252): **105 registros corrompidos** ("JÃ©ssica", "ExtraÃ§Ã£o") em `professionals` (name+specialty), `products`, `commission_rules.procedimento` e `specialties`. O Junior pegou na tela da agenda. Reparo aplicado direto no banco em 29/07 com `convert_from(convert_to(col,'WIN1252'),'UTF8')`, prévia SELECT + checagem de colisão antes, verificação final = 0 restantes. **Nenhum arquivo do repo mudou.** Relevância pro Codex: ao revisar o Pacote 3, saber que os DADOS de produção passaram por esse reparo (não estranhar timestamps de update) e que a pipeline de semeadura (fora do repo) era a fonte do defeito.

---

## Como adicionar um pacote novo (template)

Ao fechar uma frente nova esta semana, copiar este bloco pro final e somar linha no índice:

```
## Pacote N — <título>
**Estado:** PENDENTE
**Camada:** 🟢 UI / 🟡 ponte de dado / 🔴 motor
**Commits:** <sha..sha, lista>
**Arquivos-chave:** <paths>
**O que testar (leigo):** <em 1-2 frases o que o Junior conferiu ao vivo>
**O que pedir ao Codex:** <foco adversarial — onde pode ter gap>
**Encosta em motor?** <não / sim — se sim, NÃO virou fundação de outra fatia>
**Prova:** test:local N/N
```
