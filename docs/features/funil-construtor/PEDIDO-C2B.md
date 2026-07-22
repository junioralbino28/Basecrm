# Pedido de execução — Entrega C2B (o motor passa a rotear)

> Segunda fatia da C2, ainda **invisível**, e a mais importante do produto até aqui:
> é ela que acaba com **"publica mas ninguém entra no fluxo"**.

## O que muda, em uma frase

Hoje `create_automation_enrollment` só é chamada pelo **botão Testar**
(`lib/automations/builder.ts:128`) e por testes. **Nenhum lead entra sozinho em
automação nenhuma.** Depois da C2B, o lead entra no fluxo certo sozinho.

> ⚠️ **CORRIGIDO em 2026-07-22 — erro conceitual meu, apontado pelo Codex.**
> A versão original desta seção dizia *"aplicar a etiqueta inscreve o lead"*.
> **Está revogado.** Follow-up existe para quem **parou de responder** — disparar no
> instante da etiquetagem mandaria *"ainda tem interesse?"* para alguém que está
> conversando com a secretária naquele momento. Além disso, a C2A torna a primeira
> etiqueta principal automaticamente
> (`20260722010000_c2a_tag_taxonomy.sql:522`), então inscrever na primeira
> atribuição faria o fluxo começar antes da tarefa-porteiro — violando o §N1.2 D2.
>
> **O correto:** `assign`/`remove` **registram interesse**; o **evento de
> esfriamento** roteia (1 interesse → inscrição · 2+ → porteiro, sem inscrição).
> Adjudicação completa em `REVIEW-PLANO-C2B.md` §1.

## O que a C2A já deixou pronto (não refazer)

- taxonomia com identidade estável, normalização e dedupe concorrente provado;
- **`assign_deal_tag` / `remove_deal_tag` / `set_primary_deal_tag`** — as três
  operações certas já existem. **Confirmei que elas ainda não emitem evento nem
  criam inscrição**: é isso que esta fatia liga.
- dependências v2 materializadas, permissões `tags.*` / `lead_sources.*` na v3.

## Leitura obrigatória

1. `SPEC-ENTREGA-C.md` **§N1.2** — as decisões **D1 e D2 do Junior**. São contrato.
2. `REVIEW-OPINIAO-ETIQUETAS.md` **§1.3 e §2** — atomicidade e **semântica
   temporal**.
3. `REVIEW-ENTREGA-C2A.md` — o que acabou de entrar.
4. `AGENTS.md`.

---

## 1. Gatilho que cria a inscrição — atômico e idempotente

A sequência que você mesmo propôs no parecer (§12) e eu adjudiquei, resumida:
validar tenant/permissão/categoria/cardinalidade → travar o negócio → aplicar as
mudanças como operações de conjunto → registrar histórico e ator → resolver o
procedimento principal → registrar evento/outbox → **criar a inscrição idempotente**
→ commit.

**Tudo isso numa transação só.** O tick então observa **tudo ou nada**: antes do
commit não encontra inscrição; depois do commit encontra inscrição e etiqueta
juntas. **Nunca resolver isto com `delay` ou "aguardar alguns segundos"** — é o erro
nº 1 relatado por usuários do GHL (`PESQUISA-ETIQUETAS.md`).

**Idempotência obrigatória:** retry não pode criar duas inscrições. O evento que
inicia automação precisa de unicidade suficiente para isso.

**A API não expõe "salvar a lista de tags".** Só `add`, `remove`, `set-primary` —
foi o `PATCH` que sobrescreve o array inteiro que quebrou o Kommo.

## 2. Executor v3 — casar por UUID

- campo **`deal.tag_ids`**, operador `contains`, valor validado como UUID da
  etiqueta;
- publicações novas usam **`schemaVersion: 3`**;
- **`caseId` continua sendo a identidade do ramo** e **não** vira o UUID da
  etiqueta — ramo e etiqueta têm ciclos de vida diferentes;
- **snapshots v1/v2 permanecem imutáveis e continuam executando** pelo caminho
  textual, usando o `legacy_value` da C2A como ponte. **Não reescrever versão
  publicada para "corrigir" referência.**

⚠️ **O whitelist de campos é SQL literal**
(`20260720010000_funil_c1a_switch_exec.sql:62`): adicionar `deal.tag_ids` exige
**substituir a função inteira**, com o caminho v2 continuando a funcionar lado a
lado. Não é ajuste de constante.

## 3. Semântica temporal — a decisão D1 do Junior

Não é "congelado" *ou* "estado atual". São os dois, cada um no seu momento:

1. a paciente **responde** → **sai do follow-up** e vai para atendimento humano;
2. a secretária edita o procedimento e escreve o contexto nas notas;
3. se ela esfriar de novo, ao **reentrar** entra pelo **procedimento novo**.

Ou seja: **o caminho congela dentro de uma passagem pelo fluxo, e a passagem
seguinte lê a etiqueta atual.** A inscrição precisa persistir a identidade de
entrada; a reentrada resolve de novo.

## 4. Saída do fluxo quando a paciente responde (D1) — o buraco de hoje

**Hoje a mensagem da paciente não pausa nada.** Ela só resolve o passo se houver
`automation_waits` com status `pending` (aí segue por "Respondeu"). Quem pausa de
fato é a **secretária ou a IA respondendo** —
`pause_automation_enrollments_for_thread` é chamada no envio `outbound|internal`
(`app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts:176-185`,
`lib/conversations/aiReply.ts:380`).

**A fresta:** paciente responde 22h · secretária vê 9h · follow-up agendado 8h
**dispara** e pergunta *"ainda tem interesse?"* a quem já respondeu. É o que faz a
clínica parecer desatenta.

**Correção:** inbound que **não** casa com wait — hoje vira
`result_status = 'unmatched'` e **não faz nada**
(`20260718040000_funil_f5_waits.sql:395-399`) — deve **pausar a inscrição** e mandar
para o humano. O lugar já existe; falta a ação.

## 5. Tarefa-porteiro (D2) — e o guard-rail

> ⚠️ **LEIA: isto é a EXCEÇÃO, não o caminho normal.**
> **Caminho normal — um procedimento, a pessoa não responde → entra no follow-up
> direto.** Sem tarefa, sem porteiro, sem espera. **Implementar o porteiro como
> etapa geral do roteamento quebraria o fluxo principal do piloto.**

A exceção: a pessoa demonstra interesse em **2+ procedimentos** e **para de
responder** → **cria-se a tarefa ANTES de qualquer follow-up**, para a secretária ou
a IA decidir pelo teor da conversa. **Só depois da decisão** ela entra no fluxo, e já
entra no certo.

Como nenhum fluxo começa antes da decisão, **não existe** a pergunta "ela recebe
follow-up enquanto a tarefa está aberta".

**Sobre o `is_primary` que a C2A criou:** ele continua sendo o mecanismo —
**só o principal dispara**. O que o Junior rejeitou foi **escolher o principal
automaticamente** (minha emenda) e **bloquear a tela** (sua proposta). Quem define o
principal, no caso ambíguo, é **a decisão registrada na tarefa**.

**A tarefa nasce com prazo curto, do mesmo dia** — ela segura o encaminhamento e o
lead esfria em 5 dias; fila parada vira lead perdido.

## 6. Carência e reentrada

**Não existe nada disso hoje** (confirmei: nenhuma referência a carência/cooldown nas
migrations). Construir: **esfriou = 5 dias**, vinculado **ao evento e à automação**,
nunca ao texto da etiqueta. Reentrada respeita a carência e resolve o procedimento
de novo (§3).

## 7. O que NÃO fazer

- **Nada de tela** — seletor de etiqueta, "Adicionar tag" e configuração são **C2C**.
  O gatilho do construtor continua exibindo a fronteira `service-tag-entity-v3`.
- Nada de N2 (passos de tarefa/mover) nem observabilidade — é **C2D**.
- Nada de mídia nem ciclo de vida de tenant — é **C3**.
- **Não ligar envio real.** `automation_live_enabled = false`,
  `delivery_mode = 'simulation'`.

## 8. Regras da entrega

- Supabase **local** apenas; nunca `eqidsihasmwwamkaqfka`.
- Sem push, sem deploy.
- **`npm run test:local` verde** — baseline atual **848/848**.
- TDD, commits separados, `IMPL-LOG-C2B.md` ao final.
- PT-BR.

## 9. Critério de aceite

Invisível, então por teste:

1. **(REVISTO)** aplicar a etiqueta **registra o interesse e NÃO inicia fluxo**; o
   **evento de esfriamento** é que roteia — com **um** interesse, inscrição no fluxo
   publicado correspondente; com **dois ou mais**, porteiro e **nenhuma inscrição**.
   **É o item central da fatia.** O relógio dos 5 dias conta do **último evento da
   conversa (inbound ou outbound)** — senão o lead nunca respondido nunca esfria;
2. a mesma operação repetida (retry) **não cria segunda inscrição**;
3. o tick **nunca** enxerga inscrição sem a etiqueta correspondente já gravada
   (tudo-ou-nada);
4. inbound da paciente que não casa com wait **pausa** a inscrição;
5. **um procedimento e sem resposta → segue para o follow-up normalmente**, sem
   tarefa nenhuma (o guard-rail do §5);
6. 2+ procedimentos e sem resposta → **tarefa criada e nenhum fluxo iniciado**;
7. reentrada dentro de 5 dias é barrada; depois, entra pelo procedimento **atual**;
8. automação publicada em v2 **continua executando** pelo caminho textual.

## 10. Antes de executar

Devolva plano + discordâncias, como nas anteriores. Se algo aqui conflitar com o seu
parecer de etiquetas ou com a C2A que você acabou de entregar, **avise** —
divergência provavelmente é erro meu ao transcrever.
