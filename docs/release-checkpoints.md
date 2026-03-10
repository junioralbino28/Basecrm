# Release Checkpoints

## Objetivo

Definir como este projeto registra pontos estaveis de rollback sem depender apenas de memoria, conversa ou ultimo deploy.

Este arquivo deve ser atualizado sempre que um checkpoint estavel for criado.

## Regra operacional

Toda evolucao relevante continua sendo registrada em:

- `docs/implementation-journal.md`
- documentacao especifica do modulo afetado

Quando um conjunto de entregas estiver estavel o suficiente para servir como ponto de retorno, deve ser criado um checkpoint com:

1. commit publicado no `main`
2. documentacao atualizada
3. tag git criada
4. registro neste arquivo

## Convencao de tags

Padrao:

- `clinic-platform-v0.x`
- `clinic-whatsapp-v0.x`
- `clinic-conversations-v0.x`

Uso:

- `platform`: marcos estruturais da plataforma interna
- `whatsapp`: marcos operacionais do modulo WhatsApp
- `conversations`: marcos do inbox e timeline

## Como usar em caso de quebra

1. identificar o ultimo checkpoint estavel neste arquivo
2. localizar a tag correspondente no git
3. comparar o estado atual com a tag
4. decidir se a correcao sera:
   - forward fix
   - rollback parcial
   - rollback completo

Importante:

- rollback nao deve ser feito sem revisar migrations e impacto no banco
- se houver alteracao estrutural em Supabase, documentar o plano de retorno antes de executar

## Checkpoints registrados

## 2026-03-10 - `clinic-whatsapp-v0.1`

Escopo:

- `Platform Admin` funcional
- criacao de clinicas
- branding e dominios
- modulo visual de WhatsApp por clinica
- healthcheck Evolution
- pareamento
- reconectar/desconectar
- webhook inbound basico da Evolution para `Conversations`

Estado validado:

- `npm run typecheck`
- `npm run lint`
- deploy publicado em `main`

Observacoes:

- este checkpoint ainda nao representa inbox completo
- outbound real e vinculacao profunda com contato/deal ainda estao pendentes
