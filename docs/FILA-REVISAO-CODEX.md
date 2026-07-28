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

Última atualização: 2026-07-27 · branch `feat/funil-construtor` · baseline `test:local` **985/985**

---

## Índice de pacotes

| # | Pacote | Camada | Estado | Parecer |
|---|--------|--------|--------|---------|
| 1 | C2C — Construtor + sincronia + nomenclatura + correções ao vivo | 🟢 UI (+🟡 ponte de dado) | **PENDENTE** | `PEDIDO-REVISAO-C2C.md` (a redigir) |
| 2 | Reforma 2 — canvas vertical + botão de trocar direção | 🟢 UI | **PENDENTE** | a redigir |
| 3 | Remuneração da equipe — cargo/pagamento, comissão por vigência, catálogos, várias especialidades, unificação do cadastro | 🔴 **MOTOR** (4 migrations + reescrita de RPC) | **PENDENTE — prioridade 1** | a redigir |
| 4 | C2D — observabilidade de LEITURA (telas "como eu confiro?") | 🟢 UI leitura | _não iniciado_ | — |
| 5 | C2D — motor (create_task / mover etapa real) | 🔴 MOTOR — **spec only** até o Codex | _não iniciado_ | spec a redigir |

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

**Estado:** PENDENTE (aguardando 29/07) · **PRIORIDADE 1 da revisão**
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
**Prova:** `test:local` = **985/985** (208 arquivos) · `eslint --max-warnings 0` limpo · `tsc` strict limpo.
**Pendência conhecida (não é bug deste pacote):** `lib/reports/summaryCsv.ts` conta leads da tabela morta `leads` (local: `leads = 0`, `contacts = 95`) — mostraria "Leads: 0" pra sempre. Documentado, ainda não corrigido.
**Decisão em aberto pro Junior:** profissional com **várias especialidades** (a Jéssica tem 4; o cadastro aceita uma). Ou escolhe a principal, ou vira tabela de ligação + seleção múltipla — e aí mexe de novo na precedência da regra.

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
