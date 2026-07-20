# Pedido de opinião ao Codex — modelo de etiquetas (N1.1, Entrega C2)

> Rodada de **opinião, não de execução**. Sem código, migration ou teste.
> Entrega esperada: `OPINIAO-CODEX-ETIQUETAS.md` nesta pasta.
> **Ordem da fila:** correção do teste da C1A → **C1B (a fatia visível)** → C2, onde isto entra. Este parecer é adiantado de propósito, para que as decisões abertas não virem código errado depois.

## 1. O que já está decidido (não reabrir sem argumento forte)

O Junior definiu, e está registrado em `SPEC-ENTREGA-C.md` §N1.1:

- **Botão "Adicionar tag"** abre um menu de **categorias**; a secretária **seleciona, nunca digita**; pode marcar **várias**.
- **Categorias são criáveis** sem código (hoje: "Procedimentos" e "Atribuição"; amanhã aparecem convênio, cidade, urgência).
- **Etiqueta de origem é entidade separada**, não uma categoria comum — ela alimenta painel comercial e, depois, conversão para o pixel.
- Quem **cria** categoria/etiqueta é Junior/admin. A secretária apenas **usa**. Isto já está enforçado na C1A: `automation.operate` saiu do default de `clinic_staff`/`vendedor`, com gate no endpoint e não só no menu.

## 2. A pesquisa (leia antes de opinar)

**`PESQUISA-ETIQUETAS.md`** — três rodadas: Kommo, GHL e fóruns. Resumo do que importa para a modelagem:

**Os dois CRMs cometeram o mesmo erro fundacional e nenhum consegue voltar atrás.**

- **Causa-raiz encontrada no board do GHL:** as tags são **referenciadas pelo nome (string), não por um ID estável**. Daí saem todas as consequências: renomear quebra automação e lista salva, variantes de caixa não podem ser fundidas, não há merge, limpar é perigoso.
- **GHL:** pedido de **categorias de tag com 731 votos, aberto desde fev/2019**, ainda "in progress". Campo tem pasta, automação tem pasta, e-mail tem pasta — **tag não tem**. Case-sensitive confirmado em FAQ oficial (`"Facebook" ≠ "facebook"`). Permissão binária (criar e usar juntos). Sem contador de uso, sem grafo de dependência, sem data/autor da aplicação.
- **Kommo:** tag **não pode ser renomeada** (doc oficial; workaround = migrar lead a lead). Apagar do lead não apaga do catálogo. `PATCH` sobrescreve o array inteiro de tags — duas automações concorrentes perdem dado. **Gatilho de tag só dispara em adição manual por humano** — o de campo dispara também por API/automação.
- **O acerto dos dois:** origem de lead é objeto de primeira classe (Kommo `source`; GHL `attributionSource` + `lastAttributionSource` sempre gravados, com UTM tipado).
- **O GHL já fez a versão certa em outro lugar:** as *Smart Tags* dos pipelines são rótulo **derivado de regra**, com dedupe automático e teto explícito.

## 3. Os dois riscos que a pesquisa jogou no nosso colo

**3.1 Corrida de escrita — o erro nº1 relatado por usuários do GHL:**
> *"Você adiciona a tag no passo 1 e checa no passo 2 com um se/então. A tag ainda não foi gravada. O contato desce pelo ramo errado. Toda vez."*

**O nosso motor tem exatamente essa forma:** a etiqueta é o gatilho e o `switch` da C1A lê etiqueta (`deal.tags`, comparação por conteúdo exato do array). **Precisa de uma resposta explícita: como garantir que a gravação está confirmada antes da avaliação?**

**3.2 Sem data e sem autor da etiqueta**, o painel do Junior não consegue dizer *"em março as indicações fecharam mais que os anúncios"*. No GHL o pedido de filtro por data tem 111 votos e nunca saiu.

## 4. As 3 decisões ainda abertas — quero sua leitura antes de fecharmos

1. **Cardinalidade por categoria.** "Procedimentos" aceita mais de uma? Um paciente pode querer facetas **e** clareamento. Se aceitar, **qual automação dispara?** A C1A já resolve parcialmente (o `switch` avalia por `order` e o primeiro que casa vence) — mas isso precisa ser **visível** para quem monta, senão vira surpresa. Vale a categoria declarar sua própria cardinalidade (uma × várias)?
2. **Origem deve ser única?** Minha posição: sim — se aceitar várias, dois leads podem somar três origens e o painel deixa de fechar. Concorda? E como tratar o caso real de lead que veio de anúncio **e** foi indicado?
3. **Onde se cria categoria e etiqueta nova.** Só na tela de configuração, ou o admin também pode criar no meio do atendimento? A segunda é cômoda e é **exatamente como as listas viram bagunça nos dois CRMs** — mas talvez seja aceitável se houver contador de uso e arquivamento.

## 5. Perguntas técnicas

6. **Modelagem.** Hoje etiqueta é `deals.tags text[]`. A proposta exige categoria, identidade estável, rótulo renomeável, normalização e contador. Isso vira tabelas próprias (`tag_categories` + `tags` + junção) ou dá para evoluir o array? **O que acontece com os dados já existentes** em `deals.tags`?
7. **Compatibilidade com o `switch` da C1A.** Ele compara `deal_tags @> array[valor]` com o texto. Se a etiqueta passar a ter ID estável, o `switch` deve passar a casar por **ID**, e o `case.value` guardar o ID em vez do texto? Isso muda o que a C1A publicou como `schemaVersion: 2`?
8. **Normalização.** Minúscula + trim + slug na escrita, com rótulo de exibição separado — concorda? Onde aplicar (banco, aplicação, os dois)?
9. **Contador de uso e dependências.** Qual a forma barata de responder *"quantos leads têm esta etiqueta"* e *"quais automações dependem dela"* sem varredura cara a cada abertura de tela?
10. **Arquivar × apagar.** Já sabemos que apagar quebra histórico (foi o que impediu a limpeza do banco local na C1A, item O5). Como modelar arquivamento para etiqueta e categoria?
11. **Origem como entidade separada.** Copiar o modelo primeira + última origem sempre gravadas? Como isso conversa com o WhatsApp, que é o canal real de entrada da clínica, e com UTM de anúncio clique-para-WhatsApp?
12. **O que está errado, arriscado ou faltando** nesta proposta — incluindo se você acha que isto deveria vir **antes** da C1B em vez de depois.

## 6. Regras da rodada

- **Sem código, migration ou teste.** Só o parecer.
- Supabase **local** apenas; nunca o banco da clínica (`eqidsihasmwwamkaqfka`).
- Sem push, sem deploy. `automation_live_enabled` segue `false`.
- Ler o `AGENTS.md` antes de qualquer comando — **as regras valem mesmo sem prompt de aprovação**.
- PT-BR.
