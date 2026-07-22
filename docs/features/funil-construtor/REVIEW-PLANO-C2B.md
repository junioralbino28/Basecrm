# Adjudicação — plano do Codex para a C2B

Data: 2026-07-22
Plano avaliado: parecer devolvido antes de codar (base `004b0ab`)
Método: cada alegação conferida no código antes de decidir.

---

## Veredito

**As quatro lacunas procedem.** A primeira é **erro conceitual meu**, não detalhe de
implementação — e a correção dele é melhor que o meu pedido.

**Aprovado com 1 correção** (o marco do relógio, §3).

---

## 1. 🔴 A contradição — ELE ESTÁ CERTO, e o erro é meu

**Verificado** em `20260722010000_c2a_tag_taxonomy.sql:522-528`:

```sql
v_make_primary := p_is_primary or not exists (
  select 1 from public.deal_tag_assignments
  where ... and removed_at is null
);
```

A primeira etiqueta de uma categoria **vira principal automaticamente**. Combinado
com o que eu escrevi — *"aplicar a etiqueta de serviço inscreve o lead"* — o
resultado é o que ele descreveu: a secretária aplica "facetas", a inscrição nasce, o
tick roda, e quando ela aplica "clareamento" em seguida **o fluxo já começou**. A
tarefa-porteiro chegaria tarde e o contrato §N1.2 D2 seria violado na prática
(*"nenhum fluxo começa antes da decisão"*).

**Mas o erro é maior do que a corrida que ele apontou, e é conceitual:**

Relendo o §N1.2 D2 com atenção — *"a pessoa demonstra interesse em 2+ procedimentos
e **para de responder**"* — o gatilho da decisão **nunca foi a etiquetagem: é o
esfriamento**. E isso vale para o caminho normal também: **um fluxo de follow-up
existe para quem parou de responder.** Disparar follow-up no instante em que a
secretária etiqueta significaria mandar *"ainda tem interesse?"* para alguém que
está conversando com ela naquele momento — exatamente o constrangimento que a D1
existe para evitar.

**Portanto: aceito a separação de eventos, e ela não é um contorno da corrida — é o
modelo correto.**

- `assign` / `remove` → **registram interesse**, não inscrevem;
- **evento de roteamento**, disparado **quando o lead esfria**, avalia o conjunto
  completo;
- **um** interesse → inscrição;
- **dois ou mais** → tarefa-porteiro, **nenhuma inscrição**;
- resolver o porteiro define o principal e **então** inscreve.

**A frase *"aplicar a etiqueta cria a inscrição"* do `PEDIDO-C2B.md` §1 fica
revogada.** O correto: *"aplicar a etiqueta registra o interesse; o esfriamento
roteia."* Vou corrigir o pedido.

**O auto-primary da C2A permanece** — com a separação, ele é inofensivo e útil:
define o default trivialmente correto quando há **um** procedimento. Quem decide no
caso ambíguo continua sendo a tarefa, como o Junior determinou.

## 2. `create_task` sem executor — PROCEDE

Confirmado: nenhuma migration insere em `public.tasks` a partir do motor, e
`20260618000000_tasks.sql` tem `contact_id` mas **não tem `deal_id`**, vínculo com
evento nem chave de idempotência.

**Aceito a proposta:** criar na C2B **apenas o porteiro especializado** (tarefa em
`tasks` + `automation_routing_gates` ligando tarefa/negócio/evento/etiquetas
candidatas + resolução idempotente). **Não puxar o executor geral de `create_task`**
— isso é N2/C2D e inflaria a fatia.

## 3. ⚠️ O marco dos 5 dias — ACEITO COM UMA CORREÇÃO

A proposta dele:
- inbound não casado pausa a passagem atual;
- **outbound humano/IA inicia ou reinicia** a espera de 5 dias;
- novo inbound cancela;
- 5 dias sem inbound → novo evento de roteamento.

**Correção obrigatória — buraco no caso mais comum do piloto:** se o relógio só
começa com **outbound**, o lead que chega e **nunca é respondido** nunca esfria, e
**nunca entra em follow-up**. É justamente o lead que mais precisa: chegou do
anúncio às 23h, ninguém falou com ele.

**O relógio conta a partir do último evento da conversa — inbound ou outbound, o que
for mais recente.** Assim:
- secretária responde → conta do outbound dela (proposta dele, preservada);
- ninguém responde → conta do inbound inicial, e o lead abandonado entra em
  follow-up em 5 dias;
- paciente responde a qualquer momento → reinicia (e cancela espera em curso).

## 4. Contexto de conversa nas RPCs — PROCEDE

Confirmado no banco:

```
create_automation_enrollment(p_automation_id, p_deal_id, p_contact_id,
                             p_thread_id, p_channel_connection_id)
assign_deal_tag(p_organization_id, p_deal_id, p_tag_id, p_is_primary)
```

A inscrição precisa de contato, thread e canal; a atribuição não tem nada disso.
Ele está certo que **escolher "a conversa mais recente" em silêncio é arriscado**.

**Aceito**, e observo que o modelo do §1 **resolve isso naturalmente**: o evento de
roteamento nasce **do esfriamento de uma conversa**, então o `thread_id` vem da
própria origem do evento, não de um chute. Falhar de forma acionável quando o
contexto estiver incompleto, e **continuar permitindo etiquetar** negócio sem
conversa (etiqueta é dado de CRM, não depende de automação).

## 5. Onde concordo sem ressalva

- Vínculo **imutável** da inscrição com evento + `entry_tag_id`, e **unicidade de
  inscrição por evento** — é o que garante idempotência de verdade.
- Executor lado a lado: v1/v2 por `deals.tags`/`legacy_value`, v3 por atribuições
  UUID; `caseId` preservado como identidade do ramo.
- Mensagem clara ao tentar publicar **dois fluxos ativos para a mesma etiqueta**.
- Bateria de testes de corrida (atribuição duplicada, dois roteadores, tick
  concorrente, resposta × tick, resolução repetida, limite dos 5 dias).
- FKs compostas por tenant.

## 6. Impacto no critério de aceite

O item 1 do `PEDIDO-C2B.md` §9 muda de *"aplicar a etiqueta cria a inscrição"* para:

> **aplicar a etiqueta registra o interesse e NÃO inicia fluxo; o evento de
> esfriamento é que inscreve** — com um interesse, inscrição direta; com dois ou
> mais, porteiro e nenhuma inscrição.

Os demais itens permanecem.

---

## Resposta

**[E] Aprovado com 1 correção:** o relógio dos 5 dias conta do **último evento da
conversa (inbound ou outbound)**, não só do outbound — senão o lead nunca respondido
nunca entra em follow-up.

As quatro lacunas entram no escopo. A separação de eventos está **aceita e
adjudicada**: era erro meu, e o modelo dele é o correto.
