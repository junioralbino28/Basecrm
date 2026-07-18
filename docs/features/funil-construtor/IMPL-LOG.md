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

---

# Entrega B (F4 → F6)

Data: 2026-07-18  
Branch: `feat/funil-construtor`

## Resultado

O motor passou a ter agendamento durável, reivindicação concorrente de jobs,
espera idempotente por resposta e um builder manual operável. O fluxo completo
de criar, salvar, publicar e testar uma automação foi verificado no navegador
contra o Supabase local. O teste gera somente uma mensagem `simulated`;
`automation_live_enabled` permanece `false`.

## F4 — Scheduler e worker concorrente

Commit: `1eb99a8` — `feat(funil): agenda e reclama jobs com lease`

- A migration habilita `pg_cron`, usa o `pg_net` já disponível e agenda o tick a
  cada cinco minutos.
- O tick materializa jobs vencidos e reconcilia ticks perdidos sem duplicar a
  chave idempotente.
- O claim usa `FOR UPDATE SKIP LOCKED`, lease com proprietário e contador de
  tentativa.
- Conclusão e retry usam compare-and-set; retries aplicam backoff e leases
  expirados voltam à fila.
- Dois ticks concorrentes produzem um único job para o mesmo passo.
- Dois workers concorrentes podem reivindicar jobs diferentes, mas o mesmo
  `job_id` aparece em exatamente um deles.

Commit complementar de teste: `541ab2b` —
`test(funil): isola corrida do scheduler por job`.

## F5 — Espera por evento e takeover humano

Commit: `42e9c25` — `feat(funil): resolve esperas e pausa no takeover`

- O inbox é idempotente por conexão e ID da mensagem no provider.
- A resolução por resposta e a resolução por timeout disputam a mesma linha com
  `UPDATE ... WHERE status = 'pending' RETURNING`; somente uma vence.
- A correlação prioriza `contextInfo.stanzaId` e usa fallback determinístico pela
  conversa quando não há quote.
- Um índice parcial mantém no máximo uma espera pendente por conversa.
- Takeover humano pausa as inscrições ativas sem apagar a espera.
- O fallback compara o horário persistido no banco, evitando que relógio do
  provider ou da aplicação altere a ordem dos eventos.

## F6 — Builder manual, biblioteca, publicação e teste

Commit: `89fe5e1` — `feat(funil): entrega builder manual e teste seguro`

- Gatilho e passos ficam na mesma tela, em uma lista vertical.
- O botão `+` entre passos abre uma busca de ações.
- Mensagens são editadas inline e também podem ser salvas/reutilizadas pela
  biblioteca, nos modos copiado ou vinculado.
- `Aguardar resposta` cria e exibe os caminhos obrigatórios `Respondeu` e `Não
  respondeu`; envio de mensagem exibe o caminho `Falhou o envio`.
- Salvar substitui o grafo em uma RPC transacional e usa revisão otimista para
  recusar edição concorrente obsoleta.
- Publicar usa o compilador e o snapshot imutável já entregues na F2.
- Testar exige versão publicada, conversa escolhida, modo `simulation` e
  `automation_live_enabled = false`; nenhum adapter de WhatsApp é chamado.

## Roteiro de demonstração no localhost

Pré-condição: aplicação e Supabase local em execução, com acesso de plataforma.

1. Abra `http://localhost:3000/platform/tenants`.
2. Na tela **Clinicas**, abra a conta que será usada na demonstração.
3. No menu lateral da conta, clique em **Automações**. O endereço terá o formato
   `http://localhost:3000/platform/tenants/<id-da-conta>/automations`.
4. Clique em **Nova automação**, dê um nome e clique em **Criar automação**.
5. No cartão **Gatilho**, informe a tag que inicia o fluxo.
6. No primeiro passo, escreva a mensagem diretamente no editor. Para demonstrar
   reuso, abra **Biblioteca de mensagens**, clique em **Salvar nova mensagem** e
   depois selecione a mensagem salva.
7. Clique no botão `+` abaixo do passo, procure **Aguardar resposta** e adicione a
   ação. A tela mostrará, na mesma sequência, os caminhos **Respondeu** e **Não
   respondeu**. O passo de envio também mostra **Falhou o envio**.
8. Clique em **Salvar** e depois em **Publicar**.
9. Clique em **Testar**, escolha uma conversa e clique em **Executar simulação**.
10. A tela confirma a simulação. O histórico recebe uma mensagem marcada como
    `simulated`; nada é enviado ao paciente ou ao provider.

## Verificação

Todas as operações de banco foram executadas exclusivamente no Supabase local.

- `supabase db reset`: migrations F1 até F6 aplicadas com sucesso.
- Regressão direcionada F1–F6: 49/49 testes aprovados em 11 arquivos.
- Teste visual no navegador: criação, edição inline, inserção de espera,
  biblioteca, salvamento, publicação e simulação concluídos sem erro da feature.
- Evidência no banco durante o teste visual: mensagem com
  `delivery_status = simulated`, automação em `delivery_mode = simulation` e
  organização com `automation_live_enabled = false`.
- `precheck:fast`: ESLint sem warnings, TypeScript sem erros e 662 testes
  aprovados; 73 testes condicionais foram pulados, sem falhas.

## Limites e segurança

- O tenant temporário usado na verificação visual foi removido pelo reset local.
- Nenhum banco remoto ou de cliente foi acessado ou alterado.
- Nenhum provider foi chamado e nenhum envio live foi habilitado.
- Nenhum push ou deploy foi executado.
