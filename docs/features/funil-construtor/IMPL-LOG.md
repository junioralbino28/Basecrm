# IMPL-LOG — Entrega A (F0 → F3)

Data: 2026-07-18  
Branch: `feat/funil-construtor`

## Resultado

A fundação do motor de automações foi implementada até a F3: ADR, authoring
multi-tenant, publicação imutável, matrículas versionadas, outbox e dispatch
simulado. O modo seguro permanece obrigatório por padrão e nenhum envio real foi
habilitado.

## F0 — ADR do motor

Commit: `b2a3f16` — `docs(funil): define ADR do motor duravel`

- Estados, invariantes, versionamento, arestas, idempotência, safe mode e
  semântica de tentativas foram formalizados em `ADR-MOTOR.md`.
- O dispatch ficará no worker da VPS, no mesmo host do ffmpeg, mas em processos
  e filas separados.
- O tick da aplicação somente materializa e reconcilia jobs; ele não chama
  providers.
- `pg_cron` + `pg_net` ficou definido como agendador da F4, em substituição ao
  Vercel Cron incompatível com a frequência necessária no plano Hobby.

## F1 — Authoring multi-tenant

Commit: `2367628` — `feat(funil): cria authoring multi-tenant`

- Criadas as tabelas `automations`, `automation_steps`,
  `automation_step_edges` e `message_templates`.
- Aplicadas chaves compostas e RLS para isolamento por organização.
- Adicionadas as permissões `automation.edit` e `automation.operate`, com
  snapshot gerado de 222 combinações cargo × permissão.
- O modo de simulação é o padrão e a capacidade de edição foi separada da
  capacidade operacional.

## F2 — Compilação e publicação

Commit: `ebf1a66` — `feat(funil): publica versoes imutaveis`

- Implementado compilador determinístico com JSON canônico e hash estável.
- Implementadas validações de DAG, órfãos, ciclos, outcomes, branches e gramática
  fechada de variáveis com fallback obrigatório.
- Templates vinculados são resolvidos e incorporados ao snapshot publicado.
- Criadas versões imutáveis e matrículas fixadas em uma versão específica.
- A semântica D+1 usa o próximo dia local da organização, respeitando timezone e
  quiet hours.

## F3 — Outbox e dispatch simulado

Commit: `8cc17ef` — `feat(funil): adiciona outbox e dispatch simulado`

- Criadas `automation_jobs` e `automation_step_attempts`, com chave de
  idempotência única e suporte a lease/status.
- Mensagens agora registram conexão, job, idempotência, ID do provider, origem,
  status, tentativas e último erro.
- O dispatch manual persiste a mensagem pendente antes de chamar o adapter.
- Timeout ambíguo após o POST produz estado `unknown`, sem retry cego com payload
  alternativo.
- O dispatch automatizado em simulação cria uma única tentativa e uma única
  mensagem, sem resolver credenciais nem chamar o provider.
- A deduplicação do webhook usa `(channel_connection_id, provider_message_id)` e
  trata corrida por restrição única.
- `automation_live_enabled` permanece `false`.

## Compatibilidade do gate

O teste estático de permissões foi atualizado para ler o snapshot vigente na
migration F1. As verificações de funções, policies e RPCs anteriores continuam
ancoradas na migration E2 original.

## Verificação

Todas as operações de banco foram executadas exclusivamente no Supabase local.

- `supabase db reset`: migrations F0/F1/F2/F3 aplicadas com sucesso.
- Integração local: 28/28 testes aprovados, incluindo isolamento E2, authoring,
  publicação e outbox.
- Snapshot de permissões: sincronizado com `permissions.ts`.
- Teste estático E2: 14/14 testes aprovados.
- `precheck:fast`: lint sem warnings, TypeScript sem erros e 716/716 testes
  aprovados em 155 arquivos.

## Limites desta entrega

- Nenhum banco remoto ou de cliente foi alterado.
- Nenhum provider foi chamado pelo fluxo automatizado.
- Nenhum envio live foi habilitado.
- Nenhum push ou deploy foi executado.
- Instalação/agendamento com `pg_cron` + `pg_net`, endpoints e lease do worker
  ficam para F4; waits ficam para F5; UI fica para F6.
