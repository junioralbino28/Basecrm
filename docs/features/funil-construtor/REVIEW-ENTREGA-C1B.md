# Revisão — Entrega C1B (fatia visível do construtor)

Data: 2026-07-20
Entrega revisada: `bb3b19f` (`IMPL-LOG-C1B.md`), branch `feat/funil-construtor`
Método: verificação independente. Não aceitei nenhuma alegação do relatório sem
conferir no código ou executar na minha mão.

---

## Veredito

**APROVADA.** O escopo combinado (T0, R1, R4, R5, R6, R7) foi entregue, a
arquitetura ficou limpa, e as duas amarrações obrigatórias foram respeitadas.

**Mas a entrega revelou uma falha que estava escondida desde a C1A**, e o motivo
de ela ter passado despercebida é mais importante que ela mesma (§3).

Nenhum achado é bloqueante para o Junior operar a tela. Um é bloqueante para a
C2.

---

## 1. O que verifiquei por execução, não por leitura

**Produção intacta — por construção.** A C1B **não tem uma linha de migration**:
`git diff --name-only 6dc85cd..HEAD -- supabase/` retorna **zero arquivos**. O
schema não foi tocado; não havia como afetar o banco da clínica.

**`precheck:fast` na minha mão:** `668 passando / 125 ignorados / 0 falhas` —
número **idêntico** ao relatado. Confere.

**T0 (a correção que eu havia exigido na C1A):** o teste agora lê o contador
antes, e asserta `previousFailures + 1` em vez de valor absoluto
(`test/funilTickHealth.local.test.ts`). É exatamente a correção certa: mede
**delta**, não estado. Reexecutável sem `db reset`.

**Amarração 1 — nenhum acoplamento novo a texto: CUMPRIDA.** O gatilho na barra
superior é **somente leitura**, sem nenhum campo de entrada
(`AutomationFlowToolbar.tsx:68-84`). Etiqueta legada aparece como texto estático;
gatilho novo mostra a fronteira `service-tag-entity-v3` marcada no DOM, pronta
para o seletor de entidades da C2. Não há input que grave texto em
`trigger_config`.

**Amarração 2 — armadilha de gesto:** motor de layout
(`automationTreeLayout.ts`) e viewport (`automationViewport.ts`) isolados em
módulos próprios **com teste unitário separado** — 106 e 52 linhas de teste. É a
forma certa: a matemática do layout dá para testar sem navegador.

**As duas correções fora de escopo são contidas e legítimas:**
- `npx` no Windows: isolada em `scripts/npx-invocation.mjs` (15 linhas) com teste
  próprio; é script de desenvolvimento, não toca runtime de produção.
- hidratação do tema: 2 linhas em `components/Layout.tsx:791-795`, apenas qual
  ícone renderiza no primeiro paint. Padrão correto.

---

## 2. 🔴 Achado bloqueante para a C2 — teste quebrado herdado da C1A

**`test/funilAuthoringIsolation.local.test.ts:164` FALHA.**

```
AssertionError: expected [] to include '41f21d1b-…'
> operador lê automações do tenant, mas não altera draft, grafo ou templates
```

**Causa-raiz, confirmada no código:** o teste cria o operador como
**`clinic_staff`** (`:89`). A policy de leitura de `automations` exige
`automation.edit` **ou** `automation.operate`
(`20260718000000_funil_f1_authoring.sql:410-419`). A **C1A removeu
`automation.operate` do default de `clinic_staff`** (`lib/auth/permissions.ts:41`
— foi a decisão do Junior de tirar Automações da vista da secretária). Logo o
`select` volta vazio, e a expectativa do teste ficou obsoleta.

**Não é regressão da C1B.** Confirmei:
`git diff --name-only 6dc85cd..HEAD -- test/funilAuthoringIsolation.local.test.ts
supabase/` retorna **zero**. A C1B não tocou nem o teste nem a policy. A falha
existe desde a C1A.

**O comportamento do sistema está CERTO; o teste é que está errado.** A secretária
não deve mesmo enxergar automações. **A correção é inverter a expectativa do
teste** — passar a afirmar que `clinic_staff` **não** lê automações, o que
transforma o teste em guarda da decisão do Junior. **Não mexer na policy.**

---

## 3. 🔴 Por que isso sobreviveu a duas entregas — o achado que importa mais

`npm run precheck:fast` **ignora 125 testes de 793** — toda a suíte de integração
contra o Supabase local. Eles só executam com `E2_SUPABASE_URL`,
`E2_SUPABASE_ANON_KEY` e `E2_SUPABASE_SERVICE_ROLE_KEY` exportadas; **sem elas,
pulam em silêncio e o comando termina "0 falhas"**.

Foi o que aconteceu **comigo e com o Codex**: nós dois rodamos `precheck:fast`,
nós dois lemos `0 falhas`, e o número bateu — porque nós dois deixamos de rodar
o mesmo terço da suíte. **Rodando de verdade, com as variáveis exportadas e o
Docker no ar:**

```
1 failed | 719 passed | 73 skipped (793)
```

**Isto é dívida minha, não do Codex.** Eu registrei a sugestão de criar
`npm run test:local` ainda na C1A e não a executei; se tivesse executado, a falha
do §2 teria aparecido lá.

**Ação obrigatória antes da C2:** criar `npm run test:local` que exporte as três
variáveis a partir de `supabase status`, **validando que a URL é 127.0.0.1 antes
de rodar**. Enquanto isso não existir, "0 falhas" no `precheck` continua sendo
uma frase que não significa o que aparenta.

Conecta com o item **O6** já registrado no `SPEC-ENTREGA-C.md`.

---

## 4. Minhas duas condições — uma cumprida, uma pela metade

**Condição 1 (gatilho vazio como estado explícito): CUMPRIDA, com ressalva.**
A tela mostra `gatilho de serviço ainda não selecionado`, não um campo em branco.
**Ressalva:** a explicação de que isso é proposital vive num `title=` — tooltip
que só aparece no hover (`AutomationFlowToolbar.tsx:80`). O Junior provavelmente
nunca vai passar o mouse ali. O texto **visível** diz "ainda não selecionado", que
lido sozinho soa como pendência dele, não como fatia futura. Ajuste pequeno:
tornar visível que a escolha chega na C2.

**Condição 2 (aviso de que ninguém é inscrito): CUMPRIDA PELA METADE.**
O `IMPL-LOG-C1B.md:113-115` explica que o texto do gatilho é intencional, mas
**não diz em lugar nenhum que a automação publicada não vai inscrever ninguém**.

Verifiquei que o fato é verdadeiro: `create_automation_enrollment` é chamada
**apenas** por `lib/automations/builder.ts:128` (o botão "Testar") e por testes.
**Não existe nenhuma inscrição automática no sistema hoje** — roteamento por
etiqueta é C2.

Era exatamente o cenário que a condição queria evitar: o Junior publica, espera
ver lead entrando, não vê nada, e reporta como quebrado. Falta uma linha em
português claro no roteiro.

---

## 5. O que ficou bom e merece registro

A decomposição. `AutomationBuilderPage.tsx` **encolheu 467 linhas** e o que saiu
virou quatro peças com responsabilidade única e teste próprio: `FlowMap`, `Dock`,
`Toolbar`, mais os dois módulos puros de layout e viewport. Isso é o oposto de
espaguete — a matemática da árvore agora é verificável sem abrir navegador, que é
justamente o que permitiu testar o gesto sem repetir o erro das duas rodadas
anteriores.

---

## 6. Ações

| # | Ação | Quem | Quando |
|---|---|---|---|
| 1 | Inverter a expectativa de `funilAuthoringIsolation.local.test.ts` — `clinic_staff` **não** lê automações. **Não** mexer na policy. | Codex | antes da C2 |
| 2 | Criar `npm run test:local` exportando as 3 variáveis com validação de alvo local | Codex | antes da C2 |
| 3 | Tornar visível (não só no tooltip) que o gatilho chega na C2 | Codex | junto da C1C |
| 4 | Acrescentar ao roteiro: "a automação publica, mas nenhum lead entra sozinho nesta fatia" | Codex | junto da C1C |

Nenhuma delas impede o Junior de abrir a tela e operar agora.
