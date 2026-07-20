# Opinião do Codex — modelo de etiquetas (N1.1, Entrega C2)

Data: 2026-07-20  
Escopo: opinião técnica, sem implementação.

## Veredito executivo

A direção central está correta: etiquetas consumidas por automação ou relatório
precisam ser entidades com UUID estável, rótulo renomeável e atribuições
auditáveis. `deals.tags text[]` não deve continuar como fonte de verdade.

Minha recomendação é manter a ordem da fila:

1. corrigir o teste persistente apontado em `REVIEW-ENTREGA-C1A.md` §4;
2. entregar a C1B;
3. implementar etiquetas na C2.

O contrato da C2 deve, porém, ser decidido agora para a C1B não criar acoplamento
novo a texto. Se a C1B tocar no gatilho, ela não deve consolidar um novo seletor
livre baseado em `deals.tags`; deve deixar uma fronteira substituível pelo seletor
de entidades da C2.

Quatro correções de premissa precisam entrar na decisão:

1. A ordem do `switch` resolve precedência **dentro de uma automação**. Ela não
   decide qual automação deve iniciar quando um negócio tem vários procedimentos.
2. A C1A restringiu `automation.operate`, mas isso não enforça quem cria
   categorias, etiquetas ou origens. São permissões diferentes.
3. A corrida descrita no GHL não é inevitável no Basecrm. O executor lê estado
   confirmado pelo PostgreSQL. Ela só será introduzida se a C2 gravar etiqueta,
   evento e inscrição em operações separadas.
4. `lead_sources` já existe no repo. Origem deve evoluir essa entidade, não criar
   um segundo catálogo concorrente.

## Evidência verificada no código

- `deals.tags` é `text[]` em
  `20251201000000_schema_init.sql`.
- `evaluate_automation_switch` lê `deal.tags` e usa comparação exata
  `@> array[v_value]`.
- O snapshot publicado novo usa `schemaVersion: 2`; `caseId` identifica o ramo,
  enquanto `case.value` ainda guarda o texto comparado.
- `materialize_automation_jobs` trava inscrições com
  `FOR UPDATE SKIP LOCKED`; `execute_automation_switch` avalia e avança a
  inscrição na mesma transação.
- `lead_sources` já tem UUID e isolamento por organização, mas só contém
  `name`, `active`, `owner_id` e timestamps.
- A RLS atual de `lead_sources` usa `can_operate_organization`, portanto staff
  pode criar, editar e excluir origens. O serviço atual expõe `delete`.
- Não encontrei no schema atual vínculo entre `lead_sources` e o negócio, nem
  campos de primeira/última origem, UTM ou histórico de atribuição.

## 1. Cardinalidade por categoria

**Decisão recomendada: sim, a categoria declara cardinalidade `single` ou
`multiple`, mas cardinalidade não deve decidir roteamento.**

Para "Procedimentos", a realidade exige múltiplos: uma pessoa pode ter interesse
em facetas e clareamento. Ao mesmo tempo, iniciar dois follow-ups independentes
para a mesma conversa seria perigoso. Portanto é necessário separar:

- **procedimentos de interesse:** zero ou vários;
- **procedimento principal de roteamento:** no máximo um.

Isso pode aparecer numa única experiência: a pessoa seleciona vários
procedimentos e um deles recebe a marca "Principal". Se houver somente um, ele
vira principal automaticamente. Se uma operação precisa iniciar automação e há
vários sem principal, a interface deve bloquear e explicar.

A automação de serviço dispara pelo UUID do **procedimento principal**, não por
qualquer elemento do conjunto. O banco deve impedir mais de um principal ativo
na mesma categoria e negócio.

O `order` do `switch` continua útil quando uma automação deliberadamente examina
vários interesses. A ordem precisa aparecer no builder como "primeiro caminho
compatível vence". Ela não substitui a regra de automação proprietária.

Também recomendo que um mesmo procedimento principal aponte para no máximo uma
automação publicada e ativa por organização. Permitir dois fluxos donos do mesmo
gatilho deve ser uma decisão explícita futura, não um efeito acidental.

## 2. Origem deve ser única?

**Sim para cada posição de atribuição; não como apagamento da história.**

Não deve existir um array desordenado de origens atuais. O modelo precisa manter:

- primeira origem conhecida;
- última origem conhecida;
- histórico append-only de toques;
- opcionalmente, origem declarada pela pessoa, separada da origem observada.

No caso "veio de anúncio e foi indicado":

- primeira origem observada: anúncio;
- último toque: indicação, se a indicação realmente foi um novo toque;
- o histórico preserva ambos;
- o relatório escolhe explicitamente first-touch, last-touch ou origem declarada.

Assim cada métrica fecha sem destruir a jornada. Somar todas as origens de um
lead como se fossem equivalentes produziria dupla contagem.

## 3. Onde criar categoria e etiqueta

Na C2 inicial, **não criar no meio do atendimento**.

- Categorias gerais e origens: tela de configuração.
- Etiqueta de serviço: pode ser criada dentro da configuração do gatilho da
  automação, pois a spec define que o fluxo é dono dela.
- No card/atendimento: somente seleção de entidades existentes.

A criação dentro do builder deve abrir o mesmo fluxo controlado da configuração,
com permissão, normalização e detecção de duplicata. Não deve ser um campo que
transforma qualquer texto digitado em entidade.

Contador e dependências ajudam a administrar o catálogo, mas não corrigem a
proliferação causada por criação livre.

Também é necessário separar permissões:

- `tags.assign`: usar etiquetas no negócio;
- `tags.manage`: criar, renomear e arquivar categorias/etiquetas;
- `lead_sources.assign`: registrar origem;
- `lead_sources.manage`: administrar o catálogo de origens.

`automation.operate` não deve ser reutilizada para isso. A RLS existente de
`lead_sources` contradiz a decisão de admin-only e precisa ser revista na C2.

## 6. Modelagem e migração de `deals.tags`

O array não comporta identidade, categoria, histórico, ator, remoção auditável ou
FK. A fonte de verdade deve virar tabelas próprias:

### Taxonomia

- `tag_categories`
  - UUID, organização, rótulo, nome normalizado, cardinalidade;
  - estado de arquivamento e auditoria;
  - cardinalidade não deve mudar livremente depois de entrar em uso.
- `tags`
  - UUID, organização, categoria, rótulo de exibição;
  - nome normalizado para dedupe;
  - código estável opcional para importações/API;
  - valor legado imutável durante a compatibilidade com v2;
  - arquivamento e auditoria.
- `deal_tag_assignments`
  - negócio, categoria e etiqueta por UUID;
  - `is_primary`;
  - aplicação: quando, ator humano/sistema/API/importação e operação idempotente;
  - remoção: quando e quem;
  - uma nova linha quando a mesma etiqueta for reaplicada depois de removida.
- `automation_tag_dependencies`
  - referência por UUID a gatilhos e casos de switch;
  - tipo da dependência, automação, draft/versão e `case_id`, quando aplicável.

As FKs devem incluir `organization_id` nos relacionamentos compostos para impedir
atribuição cross-tenant mesmo por código privilegiado malformado.

### Migração dos dados atuais

Fazer uma transição aditiva:

1. inventariar valores distintos por organização;
2. criar categoria de importação/legado e entidades para os valores existentes;
3. detectar colisões de normalização para revisão — nunca fundir silenciosamente;
4. criar atribuições atuais preservando o texto legado;
5. passar novos leitores e escritores para as tabelas;
6. manter `deals.tags` apenas como ponte compatível com snapshots v2;
7. remover o array somente em uma entrega futura, depois de não haver executor
   dependente dele.

Os dados antigos não possuem data nem autor. A migração não pode fabricar esses
valores usando `created_at` ou `updated_at` do negócio. Deve marcar
`provenance = legacy_migration`, registrar quando foi importado e declarar
data/autor originais como desconhecidos. Relatórios temporais devem excluir ou
separar esse legado.

## 7. Compatibilidade com o `switch` da C1A

**Publicações novas devem casar por UUID e usar `schemaVersion: 3`.**

Não recomendo colocar UUID dentro de `field = deal.tags` como se ainda fosse
texto. O contrato deve tornar a semântica explícita, por exemplo:

- campo `deal.tag_ids`;
- operador `contains`;
- valor validado como UUID da etiqueta.

O `caseId` continua sendo a identidade estável do ramo. Ele não deve virar o UUID
da etiqueta, porque ramo e etiqueta têm ciclos de vida diferentes.

Compatibilidade:

- schema v1/v2: executor legado continua comparando o valor textual;
- schema v3: executor consulta atribuições por `tag_id`;
- snapshots antigos permanecem imutáveis;
- rótulo pode ser renomeado sem alterar o UUID nem versões v3;
- enquanto houver v2 ativa, a ponte mantém um `legacy_value` imutável por tag,
  independentemente do rótulo visível.

Não reescrever v2 para "corrigir" referências. A mudança semântica justifica uma
versão nova do formato.

## 8. Normalização

Concordo com normalização na escrita, com uma distinção:

- o rótulo exibido preserva capitalização e acentos;
- o valor normalizado serve apenas para dedupe e busca;
- UUID é a identidade usada por automações;
- slug/código é estável e não participa da igualdade operacional.

Normalização recomendada: trim, colapso de espaços, Unicode normalizado,
minúsculas e comparação sem acento. Assim `Indicação`, `indicacao` e
` indicação ` não criam três entidades.

A aplicação faz a prévia e apresenta a entidade já existente. O banco é a
autoridade final, com função canônica e índice único por
`(organization_id, category_id, normalized_name)`. Duas requisições concorrentes
devem devolver a mesma entidade, não criar duplicatas.

O índice deve considerar arquivados. Tentar recriar o nome de uma etiqueta
arquivada deve oferecer restauração, não gerar outra identidade.

## 9. Contador de uso e dependências

Não começaria com contador mutável dentro de `tags`; ele introduz drift.

Para a escala atual, a resposta barata é:

- índice parcial sobre atribuições ativas por organização e `tag_id`;
- `count(*)` indexado para negócios atuais;
- índice por data para histórico;
- dependências materializadas em tabela na mesma transação de salvar/publicar.

O catálogo deve mostrar pelo menos:

- negócios atualmente etiquetados;
- aplicações históricas;
- drafts que referenciam a etiqueta;
- versões publicadas ativas que a usam como gatilho ou caso.

Não varrer JSON de todas as versões a cada abertura. A publicação v3 grava as
dependências normalizadas junto com o snapshot. Drafts também precisam aparecer:
ou a tabela é atualizada a cada salvamento, ou o save extrai suas referências.

Se o volume futuro exigir contador cacheado, ele pode ser acrescentado com rotina
de reconciliação. Não é necessário na primeira versão.

## 10. Arquivar × apagar

Etiqueta e categoria usadas devem ser arquiváveis e não apagáveis pela interface.

Ao arquivar uma etiqueta:

- ela sai dos seletores para novas atribuições;
- atribuições e histórico existentes continuam legíveis;
- versões publicadas continuam resolvendo o UUID;
- uma dependência ativa como gatilho deve bloquear o arquivamento até a automação
  ser republicada/desativada, com mensagem e link para os dependentes.

Categoria com etiquetas ativas não deve sofrer cascade silencioso. A operação
precisa exibir impacto e arquivar os filhos explicitamente, respeitando os
bloqueios de dependência.

Hard delete só é defensável para entidade nunca usada, sem atribuição, evento,
draft ou versão publicada. Mesmo nesse caso, pode ficar restrito a uma rotina
administrativa.

Também falta decidir **merge**. Dedupe impede novas duplicatas, mas o legado pode
conter duas entidades equivalentes. Merge deve reatribuir referências em
transação, preservar alias e registrar auditoria; não é o mesmo que apagar.

## 11. Origem como entidade separada

Reaproveitar e evoluir `lead_sources`.

O catálogo existente precisa ganhar identidade operacional completa:

- nome normalizado e restrição de unicidade por organização;
- código estável;
- arquivamento em vez de `delete`;
- permissão admin-only para gestão.

Além do catálogo, criar histórico de atribuição:

- negócio/contato;
- `source_id`;
- instante observado;
- canal;
- UTM tipado;
- `fbclid`, `gclid`, referrer e campanha, quando existirem;
- proveniência: automática, API, importação ou declaração humana;
- `external_event_id`/idempotency key;
- referência ao dado bruto de integração quando aplicável.

Primeira e última origem podem ser ponteiros/cache no negócio, mantidos na mesma
transação do evento. O histórico continua sendo a fonte auditável.

WhatsApp é canal de entrada, não necessariamente origem de marketing. Um lead
pode entrar pelo WhatsApp vindo de Meta, Google, perfil orgânico ou indicação.
No clique-para-WhatsApp, a atribuição precisa ser capturada antes do salto ou
extraída de metadata de referral fornecida pelo provedor, e depois correlacionada
à conversa. Se essa evidência não vier, registrar `desconhecida/WhatsApp orgânico`
ou pedir seleção humana com proveniência manual; nunca inferir anúncio apenas
porque o canal foi WhatsApp.

Não encontrei no repo atual ingestão de UTM/referral para essa correlação. A
capacidade exata do provedor de WhatsApp usado no piloto ainda precisa ser
verificada antes do plano da C2.

## 12. Corrida, riscos faltantes e ordem

### Corrida de escrita

Não resolver com delay nem com "aguardar alguns segundos".

A operação futura precisa ser uma única transação/RPC:

1. validar tenant, permissão, categoria e cardinalidade;
2. travar o negócio;
3. aplicar adições/remoções como operações de conjunto;
4. registrar histórico e ator;
5. escolher/validar o procedimento principal;
6. registrar evento/outbox de roteamento;
7. criar a inscrição idempotente ou deixar o evento pronto para consumo;
8. commit.

O tick então observa **tudo ou nada**. Se executar antes do commit, não encontra
a nova inscrição; depois do commit, encontra inscrição e etiqueta juntas.

Cada operação recebe idempotency key. O evento que inicia automação também deve
ter unicidade suficiente para retry não criar duas inscrições.

O cliente nunca deve baixar a lista, modificá-la e sobrescrevê-la. A API expõe
operações `add/remove/set-primary`, com controle de concorrência.

### Semântica temporal

Há um risco mais sutil que a proposta ainda não separa:

- **gatilho de entrada:** deve usar o `tag_id` do evento confirmado e persistir
  essa identidade na inscrição;
- **switch de estado atual:** pode consultar atribuições ativas no momento em que
  executa;
- **decisão congelada na entrada:** precisa consultar snapshot/contexto da
  inscrição, não o estado atual do negócio.

Hoje o switch da C1A lê o estado atual. Se a etiqueta mudar entre inscrição e
execução, o ramo também muda. A C2 deve nomear essas duas semânticas para isso não
parecer uma corrida quando for, na realidade, uma decisão de produto.

### Outros itens faltantes

- evento de remoção e regra de reentrada ao remover/reaplicar;
- carência de cinco dias vinculada ao evento e à automação, não ao texto;
- ator tipado para humano, IA, automação, API, importação e migração;
- operação em lote atômica;
- política para alteração de cardinalidade de categoria em uso;
- aliases e merge para o legado;
- proteção cross-tenant por FK, não apenas por RLS;
- estado desconhecido explícito na atribuição de origem;
- reconciliação se contador cacheado for criado futuramente.

### Ordem final

Etiquetas **não devem vir antes da C1B**. O risco de infraestrutura/dados é
independente da árvore visual, e antecipar a C2 atrasaria o marco que o Junior
opera.

A única amarração é: a C1B não pode criar contrato novo dependente de texto para
gatilho ou switch. Decidimos agora UUID + schema v3; implementamos depois da
C1B.

## Decisões que eu fecharia antes do plano técnico da C2

1. Categoria declara `single|multiple`.
2. Procedimentos são múltiplos, com exatamente um principal quando houver
   roteamento.
3. Apenas o procedimento principal inicia automação.
4. Um procedimento principal tem no máximo uma automação publicada ativa.
5. Origem usa primeira + última + histórico; nunca array de origens correntes.
6. Criação não acontece no atendimento; admin gerencia em configuração/builder.
7. Taxonomia tem permissões próprias de usar e administrar.
8. Fonte de verdade vira tabelas; `deals.tags` fica temporariamente só para v2.
9. Publicações por UUID usam `schemaVersion: 3`.
10. Atribuição, evento e inscrição são atômicos e idempotentes.
11. Arquivar é o fluxo normal; merge é operação própria; apagar é exceção.
12. `lead_sources` existente é evoluída e recebe trilha de atribuição.
