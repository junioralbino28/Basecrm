# Pedido de opinião ao Codex — Entrega C1

> Rodada de **opinião, não de execução**. Não escrever código, migration nem teste nesta rodada.
> Escrito por Claude em 2026-07-18. Entrega esperada: `OPINIAO-CODEX-C1.md` nesta mesma pasta.

## 1. O que mudou desde a Entrega B

A B foi aprovada (`REVIEW-ENTREGA-B.md`). Depois disso o **Junior operou a tela pela primeira vez** e o construtor mudou de forma:

- Ele achou **3 defeitos reais** que teste nenhum pegaria: botão desabilitado que parecia não existir; **os dois desvios do `wait_for_event` renderizados como passos 4 e 5 sequenciais** (a tela afirmava uma ordem que não existe); e clique morto no cartão.
- A decisão de layout mudou **duas vezes** e agora está travada: **árvore horizontal em tela cheia, com layout automático, doca inferior contextual e mapa navegável (pan + zoom)**. **Não é canvas livre** — o sistema posiciona, o usuário só navega e move passos soltando sobre uma linha.
- O Junior **aprovou o visual**. A referência oficial é `mockup-tela-real.html` (abrir no navegador; é HTML puro, sem dependência).

Escopo, tamanhos e fatiamento estão em **`SPEC-ENTREGA-C.md`**. A recomendação é fazer a **C1 = Bloco 1 + O1 + O2** sozinha.

## 2. Ler nesta ordem

1. `SPEC-ENTREGA-C.md` — escopo, tamanhos, fatiamento, critério de sucesso
2. `mockup-tela-real.html` — **abrir no navegador**, não só ler o código
3. `ADR-MOTOR.md` — invariantes do motor que a C1 não pode quebrar
4. `REVIEW-ENTREGA-B.md` §9 — os 3 itens técnicos que ficaram em aberto
5. Código: `lib/automations/compiler.ts` (validação), `supabase/migrations/20260718000000_funil_f1_authoring.sql` (tipos e arestas)

## 3. O problema que eu já encontrei e não sei resolver sozinho

**O mockup aprovado tem um formato que o schema atual não suporta em um nó só.**

No mockup, o passo "Divide caminho" tem **4 saídas nomeadas**: `lentes`, `ortodontia`, `estética`, `não identificou`. Verifiquei o que existe hoje:

- **Banco** (F1, L339): `outcome in ('success','answered','timeout','failed','true','false','otherwise')`
- **Compilador** (`compiler.ts` L467): `ALLOWED_OUTCOMES[stepType]` por tipo de passo
- **Compilador** (L474): **`duplicate_outcome`** — o mesmo outcome não pode se repetir no mesmo passo

Ou seja: um passo `condition` hoje comporta no máximo **`true` / `false` / `otherwise`**, e os rótulos são binários, não nomeados por serviço.

**Três saídas que enxergo — quero a sua leitura, inclusive se houver uma quarta:**

- **(a) Encadear condições.** `condition(é lentes?)` → `true` vai pro ramo; `false` cai em outro `condition(é ortodontia?)`, e assim por diante. **Funciona hoje, sem migration.** Custo: a árvore vira escada, e o mockup aprovado mostra um nó com 4 saídas lado a lado — visualmente é outra coisa.
- **(b) Novo tipo `switch`** com N casos, outcome no formato `case:<slug>` e o rótulo legível no `config`. Custo: migration (constraint do outcome + tipo do passo), mexer em `ALLOWED_OUTCOMES`, na regra de `duplicate_outcome` e no compilador. Mexe em código já revisado e aprovado.
- **(c) Manter `condition` e liberar outcomes dinâmicos.** Parece o menor caminho, mas suspeito que enfraquece a validação que hoje protege o publicar — **me diga se essa suspeita procede**.

**Isto é bloqueante para R2 e muda o tamanho da C1.** É a pergunta mais importante desta rodada.

## 4. Perguntas

1. **Modelagem dos N caminhos** — a de cima. Qual opção, e por quê? Se for (b) ou (c), o que exatamente quebra no que já está aprovado?
2. **Mover passo soltando na linha (R3).** No mockup, mover = tirar o nó do lugar (o filho dele assume) e inseri-lo na aresta destino (A→n→B). **Onde essa mutação deve morar?** Reescrever o conjunto de arestas pelo endpoint de save já existente, ou um RPC dedicado que faça a religação atomicamente? Como garantir no **servidor** (não só no cliente) que não nasce ciclo nem passo órfão?
3. **Layout automático.** Precisa persistir alguma coisa (ordem entre irmãos, por exemplo) ou `automation_steps.sort_key` + `automation_step_edges.order` já bastam para o desenho ser **determinístico** entre sessões e usuários?
4. **O1 — permissão.** Incluir `automation.operate` em `CLINIC_STAFF_DENIED` obriga a regenerar o snapshot travado (222 linhas). Qual a forma correta: **nova migration** com o snapshot atualizado (mantendo a da F1 intacta, como fizemos no E2), ou existe caminho melhor? Lembrando que a decisão do Junior é: **automação visível só para agência e admin da clínica; qualquer outro apenas por toggle manual.**
5. **O2 — tick que falha calado.** `request_automation_tick()` tem `exception when others then return null`. Como registrar tentativa e resultado **sem** criar uma tabela que cresce sem limite e sem transformar cada tick numa escrita cara? Retenção curta? Só último resultado + contador?
6. **Ordem de execução da C1.** Qual sequência você faria e por quê? Onde você começaria a escrever teste, considerando que a maior parte é interface?
7. **Armadilha de gesto.** Documentei em `SPEC-ENTREGA-C.md` que `setPointerCapture` faz o `click` ir para o palco e não para o cartão — me pegou **duas vezes** no mockup. Existe abordagem melhor que a que usei (guardar o alvo no `pointerdown` e decidir no `pointerup`)?
8. **O que você acha errado, arriscado ou faltando** nesta spec — inclusive se achar que o fatiamento está errado ou que a C1 ainda está grande demais.

## 5. Regras da rodada

- **Sem código, migration ou teste.** Só o parecer.
- **Nunca** rodar nada contra o banco da clínica (`eqidsihasmwwamkaqfka`). Supabase local apenas.
- Não reabrir sem argumento forte: **árvore com layout automático (não canvas livre)** · doca inferior · mapa navegável com piso de zoom · `pg_cron`+`pg_net` como agendador · dispatch no worker da VPS · fluxo escolhido por etiqueta · IA gera / humano publica · safe mode obrigatório.
- PT-BR.
