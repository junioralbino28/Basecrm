# Pesquisa — como Kommo e GHL modelam etiquetas e atribuição de origem

> Levantada em 2026-07-20 a pedido do Junior, antes de fechar o desenho do N1.1 (etiquetas controladas por categoria).
> Confiança marcada por afirmação. O que não foi verificado está declarado como tal.
> **GHL: pesquisa em andamento — esta seção será preenchida quando voltar.**

## Por que esta pesquisa existe

O Junior propôs: botão **"Adicionar tag"** → menu com **categorias** (Procedimentos, Atribuição, e outras criáveis) → a secretária **seleciona, nunca digita**, e pode marcar várias. Antes de construir, quisemos saber se os dois CRMs de referência já resolveram isso — e onde dói para quem usa há anos.

---

## Kommo (ex-amoCRM)

### O achado central

**O Kommo tem a peça certa e a peça errada no mesmo produto.**

| | Origem do lead | Etiqueta |
|---|---|---|
| Modelagem | **Objeto de primeira classe** (`source`, com `external_id`, pipeline de destino, relatório dedicado) | **Lista plana de texto livre** |
| Renomear | sim | **NÃO — é permanente** |
| Relatório | ROI report nativo por origem e por UTM | filtro apenas; **não é dimensão de agrupamento** |

A diferença de qualidade entre as duas mostra que o problema nunca foi capacidade técnica: foi **decidir cedo se aquilo era vocabulário controlado ou anotação livre.**

### 1. Tags: lista plana, sem categoria `[Alta confiança]`

Não existe grupo, categoria ou hierarquia. Na API v4 o objeto tag tem **apenas `id`, `name`, `color`** — sem `parent_id`, `group_id` ou `category`.
O que parece agrupamento é acidental: o diretório é **separado por tipo de entidade** (lead, contato, empresa — a mesma palavra vira registros com IDs diferentes) e o **filtro é escopado por pipeline**. Isso dá a ilusão de taxonomia entregando três listas planas desconectadas.

### 2. Criação por digitação — e sem volta `[Alta confiança]`

Clica em `#ADD TAGS`, digita, salva sozinho. Sugestões aparecem, mas nada obriga a escolher uma existente.
**E a documentação oficial admite:** *"At the moment it's not possible to change the name of an existing tag."* O caminho sugerido por eles é criar outra, refiltrar todos os leads, reatribuir e apagar a velha.

> **Estas duas decisões, isoladas, são defensáveis. Juntas são tóxicas.** "Implante", "implante", "Implante " e "Implnate" viram quatro registros eternos sem caminho de correção. **É exatamente o problema que a proposta do Junior elimina na origem.**

Existe um toggle que **impede usuários de criar tags novas** `[Confiança média — 1 fonte primária; não aparece no sistema geral de permissões]`.

### 3. Campo select existe e é a escolha certa lá `[Alta confiança]`

21 tipos de campo, incluindo `select`, `multiselect`, `radiobutton`, `category`, com `enums` que ganham `id` e aceitam `enum_code` (código simbólico estável, além do ID numérico).

> **O Kommo NÃO publica recomendação de usar select em vez de tag** `[não verificado — procurado em blog, suporte e docs]`. A superioridade é mecânica: opção renomeável, código estável, gatilho que reage a escrita por API. **Não atribuir a eles uma doutrina que não têm.**

### 4. Origem: entidade dedicada + UTM nativo `[Alta confiança]`

- Até **100 sources** por integração, com `external_id` único e pipeline de entrada.
- **UTM é tipo de campo próprio** (`tracking_data`) e os campos são **criados automaticamente com a conta**: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `referrer`, `gclientid`.
- Anúncio clique-para-WhatsApp captura UTM sozinho `[média]`.
- **ROI report** filtra por UTM e por canal — os dois casos de uso estão na doc oficial.

### 5. ⚠️ Gatilho de tag só reage a ação humana `[Alta confiança]`

| Gatilho | Comportamento |
|---|---|
| *"When a user adds a tag"* | dispara **só em adição manual por usuário** |
| *"When the entity field is updated"* | dispara **em qualquer mudança — inclusive por automação e API** |

**Consequência direta para o nosso caso:** no Basecrm a IA vai qualificar e etiquetar sozinha. Um gatilho com essa semântica **funcionaria no teste manual e falharia calado em produção**. É a mesma família de falha muda que corrigimos hoje na C1A.

Limite: 25.000 ações de tag por hora; ao estourar, **todos os gatilhos de tag param** com aviso.

### 6. Dores — documentadas pelo próprio fornecedor

| Dor | Evidência |
|---|---|
| Tag não renomeia | doc oficial `[alta]` |
| Digitação livre → proliferação garantida | doc + inferência direta `[alta]` |
| Apagar tag do lead **não** apaga da conta — lixo invisível cresce | doc oficial `[alta]` |
| `PATCH` sobrescreve o array inteiro (sem add/remove) → duas automações concorrentes perdem dado | doc + queixa real de usuário `[alta]` |
| Relatório agrupado **por tag** não existe; tag é filtro, não dimensão | ausência consistente `[média]` |

> **Lacuna honesta declarada pela pesquisa:** não foi encontrado volume real de reclamação pública sobre proliferação de tags no Kommo (comunidade dispersa, muito em russo/espanhol). A tese se sustenta pela **mecânica documentada**, não por queixa observada.

---

## O que copiar

1. **Origem como entidade própria, nunca como tag.** Já era nossa decisão; agora tem precedente forte.
2. **UTM como campo nativo provisionado automaticamente** — conversa direto com o plano de conversão pro pixel.
3. **Criar tag repetida devolve a existente** em vez de duplicar.
4. **Código simbólico estável além do ID numérico** — reduz acoplamento frágil na automação.
5. **Cor como lista fechada** (22 opções), não cor livre.

## O que evitar

1. **Texto livre + impossível renomear.** Nunca as duas ao mesmo tempo: ou permite renomear, ou força seleção.
2. **Apagar do registro sem apagar do catálogo** — lixo que ninguém vê e ninguém limpa.
3. **Escrita que sobrescreve a lista inteira** sem operação de adicionar/remover.
4. **Gatilho que ignora escrita por API/automação.**
5. **Dado categórico que só serve de filtro e nunca de agrupamento** — parece capturado e é inútil na hora de decidir.
6. **Escopo fragmentado** (por entidade, por pipeline) que simula organização sem entregar taxonomia.

## Como isso ajusta o nosso desenho

- A proposta do Junior (**categorias + seleção, sem digitação**) resolve na origem a dívida central do Kommo.
- **Renomear rótulo tem que ser possível desde o dia 1**, com identidade estável por baixo — mesma lição do `case_id` do `switch` na C1A.
- **Etiqueta de origem continua entidade separada**, não uma categoria de tag qualquer.
- **O gatilho da automação precisa reagir a etiqueta posta por qualquer um** — humano, IA ou API. Não repetir a armadilha do Kommo.
- **Arquivar em vez de apagar**, e nunca deixar o catálogo acumular lixo invisível.
