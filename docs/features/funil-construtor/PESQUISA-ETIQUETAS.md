# Pesquisa — como Kommo e GHL modelam etiquetas e atribuição de origem

> Levantada em 2026-07-20 a pedido do Junior, antes de fechar o desenho do N1.1 (etiquetas controladas por categoria).
> Confiança marcada por afirmação. O que não foi verificado está declarado como tal.

## Conclusão que vale mais que a pesquisa inteira

**Os dois CRMs cometeram o MESMO erro fundacional: tag virou texto livre em vez de entidade.** Falta de categoria, duplicata por digitação, relatório que não agrupa e permissão tudo-ou-nada são todos consequência dessa única decisão.

**E nenhum dos dois consegue voltar atrás.** No GHL o pedido de categorias de tag está aberto **desde fev/2019 com 731 votos** — sete anos, status "in progress". Não é funcionalidade faltando: é remodelar dado com base instalada gigante. No Kommo, a tag é **impossível de renomear** e a própria doc manda migrar lead a lead.

**A proposta do Junior (categorias + seleção, sem digitação) é exatamente o que 731 pessoas pedem ao GHL há sete anos.** Estamos antes da decisão que os dois não conseguem desfazer.

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

---

## GoHighLevel

### 1. Tags: lista plana, e eles admitem `[Alta confiança]`

Sem grupo, categoria, pasta ou aninhamento. **A própria GHL confirma no changelog**, listando em *"What's next?"*: **"Tag categories for better organization"**.

**A assimetria que denuncia o problema:** campos personalizados **têm pasta**, automações **têm pasta**, e-mails **têm pasta**. Tags não. Comentário de usuário no board: *"Automations? folders / Emails? folders / Custom Fields? folders / Tags? only chaos"*.

| Pedido no board oficial | Votos | Aberto em | Status |
|---|---|---|---|
| **Categorias de tag** | **731** | **fev/2019** | "In progress" há 7 anos |
| Tags coloridas | 358 | nov/2019 | "In progress" |
| Contador de contatos por tag | 116 | jan/2024 | "Planned" |
| Permissão separada criar × usar | 71 | set/2022 | aberto |

Workaround da comunidade: **prefixo no nome** (`source-`, `proc-`) `[média]` — funciona porque o dropdown busca por substring. É convenção social, não regra de sistema: nada impede alguém criar `Origem Facebook` do lado.

> ⚠️ **Armadilha de pesquisa registrada:** o artigo "How to manage categories, types and tags" aparece em toda busca e **não é sobre contatos** — é da Template Library. Não vale como evidência.

### 2. Dropdown com criação embutida `[Alta confiança]`

O mesmo campo permite *"escolher uma ou várias tags existentes"* **ou** *"digitar o nome da nova tag"* e clicar **"Add New Tag"**. É lista fechada e campo livre ao mesmo tempo — a raiz de todas as dores.

**Restringir quem cria: não dá hoje** `[média-alta]`. A permissão é binária: acesso total (inclui criar) ou nada.

### 3. Atribuição: objeto dedicado, e é o acerto deles `[Alta confiança]`

- **Dois campos sempre gravados:** `attributionSource` (primeira) e `lastAttributionSource` (última), com subcampos tipados (`utmSource`, `utmMedium`, `campaign`, `referrer`, `fbclid`, `gclid`…).
- **9 tipos de origem**; os 3 últimos (CRM UI, Third-Party, Others) foram acrescentados justamente porque contato criado à mão/CSV/API sujava o relatório.
- Relatórios nativos: **Source Report** e **Conversion Report**.

**3 limitações verificadas:** só captura em eventos nativos do GHL (*"Non-HighLevel events will not capture attribution data"*) · UTM com valores mágicos e **case-sensitive** (`utm_source=fb_ad`) · atribuição **não vem no endpoint de busca**, só no GET individual — puxar em massa exige N requisições.

### 4. Campo select existe e é o recomendado para categórico `[média]`

Existe **Dropdown (Single Select)** e múltiplo, sem limite prático de opções. A regra de decisão da comunidade: *evento discreto ou estado binário → tag; valor que pode ser um entre muitos, muda com o tempo ou precisa de relatório → campo*. O anti-pattern nomeado é exatamente o nosso caso: criar uma tag para cada valor possível gera *"uma lista de centenas de entradas, sem lógica de nome, e busca em que ninguém confia"*.

### 5. ⚠️ Case-sensitive, confirmado em FAQ oficial `[Alta confiança]`

Pergunta oficial: *"'Facebook' e 'facebook' seriam tratadas como tags separadas?"* — **"Yes."** Sem normalização, sem dedupe por caixa. **Uma letra maiúscula quebra o workflow em silêncio.**
Caracteres especiais também quebram o filtro: o sistema deixa criar `This & That`, mas depois *"não puxa a lista de contatos corretamente"*.

### 6. 💡 O GHL já fez a versão CERTA — em outro lugar

Nos pipelines de oportunidade existem **Smart Tags**: chips coloridos **derivados de regra**, avaliados em tempo real, com **dedupe automático** (*"tags duplicadas no mesmo pipeline são bloqueadas automaticamente"*) e teto explícito de 60.

**É rótulo computado, não digitado.** Eles sabem qual é o desenho bom — só não aplicaram em contatos por peso de legado.

---

## O que copiar

0. **Primeira + última origem, sempre gravadas** (do GHL). Barato, e resolve "de onde veio esse paciente" sem modelo de atribuição sofisticado.
1. **Origem como entidade própria, nunca como tag.** Já era nossa decisão; agora tem precedente **nos dois**.
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

7. **Normalizar na escrita** (minúscula, sem espaço nas pontas, slug) e guardar o rótulo de exibição **separado**. Custa dez linhas e elimina uma classe inteira de dor que os dois carregam.
8. **Contador de uso + "quem depende disto" desde o dia 1.** A dor mais repetida do fórum do GHL é não saber quantos contatos têm cada etiqueta nem qual automação usa qual — então **ninguém apaga nada, com medo de quebrar**. Barato agora, impossível de retrofitar (o GHL não conseguiu em 7 anos).
9. **Permissão separada: usar × criar.** Pedido aberto no GHL com 71 votos. É exatamente o nosso caso: secretária **usa**, admin **cria**.

## O que evitar (acrescentado pelo GHL)

7. **Prefixo como substituto de estrutura** (`src_facebook`, `proc_implante`). É o workaround da comunidade e é frágil: depende de disciplina humana, não sobrevive a troca de equipe, e o sistema não valida nada. **Prefixo é o sintoma de uma tabela que faltou.** Se já sabemos que existem duas dimensões, modelamos duas dimensões.
8. **Permissão binária em taxonomia** — ou tudo, ou nada.
9. **Comparação sensível a maiúscula sem normalização** — é bug de produto vendido como comportamento.

## Como isso ajusta o nosso desenho

- A proposta do Junior (**categorias + seleção, sem digitação**) resolve na origem a dívida central do Kommo.
- **Renomear rótulo tem que ser possível desde o dia 1**, com identidade estável por baixo — mesma lição do `case_id` do `switch` na C1A.
- **Etiqueta de origem continua entidade separada**, não uma categoria de tag qualquer.
- **O gatilho da automação precisa reagir a etiqueta posta por qualquer um** — humano, IA ou API. Não repetir a armadilha do Kommo.
- **Arquivar em vez de apagar**, e nunca deixar o catálogo acumular lixo invisível.
