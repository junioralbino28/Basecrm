# Revisão — Entrega C2B (o motor passa a rotear)

Data: 2026-07-22
Entrega revisada: `804aec7`, branch `feat/funil-construtor`
Método: verificação independente. Nada aceito sem conferir no código, no banco ou
executando.

---

## Veredito

**APROVADA, sem correção pendente.** Terceira entrega seguida sem defeito meu.

É a fatia que muda o produto — o motor deixa de ser vitrine e passa a trabalhar
sozinho. As duas decisões que essa rodada dependia (a revogação do "etiquetar
inscreve" e o marco do relógio) foram implementadas exatamente como adjudicado, e o
caso-limite que eu levantei **tem teste próprio**.

---

## 1. 🟢 A revogação — implementada e provada

Era o coração da adjudicação: **atribuir etiqueta NÃO inscreve; o esfriamento
roteia.** O teste `c2bCoolingRouting.local.test.ts:203` prova as duas metades numa
tacada:

```
expect(beforeCooling.data).toEqual([]);         // etiquetar não inscreveu
...                                              // 6 dias depois:
expect(events.data).toEqual([{ status: 'enrolled', candidate_count: 1, ... }]);
expect(enrollments.data).toHaveLength(1);        // o esfriamento inscreveu
```

E a corrida está coberta no mesmo teste: **dois `process_due_automation_routing`
concorrentes** e o resultado é **uma** inscrição, não duas. Idempotência real, não
promessa.

## 2. 🟢 Minha correção do relógio — aplicada, e o meu caso-limite tem teste

Eu exigi que os 5 dias contassem do **último evento da conversa (inbound OU
outbound)**, não só do outbound, senão o lead nunca respondido nunca esfria.

**Verificado:** o gatilho `record_automation_conversation_activity` dispara
`after insert on conversation_messages` **sem filtro de direção**
(`20260722050000:384-386`) — qualquer mensagem alimenta o relógio.

**E o meu caso-limite exato virou teste** (`:203`): o cenário insere **apenas um
inbound, nenhum outbound**, e o lead **entra no fluxo** depois dos 5 dias. É
precisamente o lead que chega do anúncio às 23h e ninguém responde — o que o plano
original do Codex teria deixado para trás. Fechado.

O reinício também está provado (`:240`): inbound antigo + outbound novo → `route_after`
recontado a partir do outbound, `generation = 2`.

## 3. 🟢 D2 — o porteiro, com o guard-rail respeitado

`c2bCoolingRouting.local.test.ts:363`: dois procedimentos → **um** porteiro,
**nenhuma** inscrição; resolver é idempotente e só então inscreve **uma vez**.

E o guard-rail que eu marquei em destaque no pedido está intacto: **um procedimento
segue sem tarefa nenhuma** (o `candidate_count: 1` do teste §1 vira inscrição
direta, sem porteiro). O caminho normal não foi contaminado pela exceção.

## 4. 🟢 Executor lado a lado — v2 e v3 sem se atropelar

`20260722060000_c2b_switch_exec_v3.sql` lê `schemaVersion` do snapshot e **separa os
mundos com trava dura**:

```sql
if v_field = 'deal.tags'    and v_schema_version >= 3 then raise ... 'v3 deve usar deal.tag_ids';
if v_field = 'deal.tag_ids' and v_schema_version <  3 then raise ... 'legado deve usar deal.tags';
```

v1/v2 continuam por `deals.tags`, v3 por `deal_tag_ids`, e **não há como um snapshot
misturar os dois** — o banco recusa. É a substituição da função inteira que eu tinha
avisado ser necessária (o whitelist é SQL literal), feita sem reescrever versão
publicada.

## 5. 🟢 A fresta das 22h — fechada

`20260722070000_c2b_inbound_pause.sql:138-143`: quando o inbound **não** casa com
espera, agora chama `pause_automation_enrollments_for_thread(..., 'patient_inbound')`
**antes** de marcar `unmatched`. Era o buraco que eu descrevi: paciente responde de
noite, follow-up das 8h dispara "ainda tem interesse?". O lugar que antes "não fazia
nada" agora pausa. Motivo tipado (`patient_inbound`) separa do takeover manual.

## 6. Gates na minha mão

| Gate | Resultado |
|---|---|
| `npm run test:local` | **869 / 869**, 191 arquivos, 0 falhas |
| `npm run lint` | verde |
| `npx tsc --noEmit` | verde |

**Produção intacta por verificação:** `main` em `be7fe35`, **34 migrations**; as 5
novas da C2B existem **só na branch**. Worktree limpo, sem push.

## 7. O que ele reportou e eu confirmo

- **Workers órfãos causaram o timeout inicial** — não é bug da entrega, é o mesmo
  tipo de zumbi que já nos mordeu com o dev server. Removidos.
- **Fixture herdada publicava gatilho textual** — ele achou e corrigiu. Boa pesca:
  uma fixture v2 num mundo que agora tem v3 mascararia regressão. Está em
  `test/helpers/funilTestFixture.ts`.

## 8. Ruído conhecido (não bloqueia)

O `DELETE .../deal_notes ... 400` de teardown continua aparecendo — 869/869 passam,
não é produto. Registrado desde a C1C.

---

## O estado do produto agora

**O motor trabalha sozinho.** Falta a **tela** para operar as etiquetas (C2C) e a
observabilidade (C2D) — mas a lógica que faz o lead entrar, esperar, esfriar, rotear,
pausar e reentrar **está pronta e provada**.

## Próximo — C2C (a primeira fatia VISÍVEL da C2)

- seletor de etiqueta no gatilho (substitui a fronteira `service-tag-entity-v3`);
- **"Adicionar tag" para a secretária** — os menus de categoria que o Junior
  desenhou, ela seleciona e nunca digita;
- tela de configuração de categorias (admin).

É a fatia em que o Junior volta a operar e o retorno dele vira parte do aceite —
como na C1B/C1C. Sugiro **eu implementar** essa (modelo invertido na UI), já que é
tela e a referência é o §N1.1 que ajudei a fechar.
