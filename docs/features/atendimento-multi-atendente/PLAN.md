# PLAN — Identidade do atendente humano no WhatsApp

> Base: `SPEC.md` desta pasta (Codex, 25/09) + as 8 objeções da revisão do Claude, todas medidas no código.
> Decisões do Junior em 25/09 fecham o escopo. Implementação: Claude. Commit local apenas — sem push, sem deploy, sem ativar o interruptor.

## Decisões do Junior que fecham este plano

1. **Trilhas separadas.** A assinatura é entregue **desligada**; as correções globais de envio (retry, vínculo chave–payload, replay, entrega incerta) vão em trilha própria, em paralelo. O interruptor só é ligado em algum cliente depois que elas passarem. *"vamos seguir sua proposta de entregar a assinatura desligada e corrigir em paralelo"*
2. **Sem guarda de assinatura digitada, e sem substituto.** *"nenhum atendente digita o primeiro nome, no máximo se apresenta, e se aparecer o nome dela não vai precisar se apresentar, e mesmo se se apresentar é só na primeira interação."* Uma apresentação ("oi, aqui é a Vitória") nunca casaria com uma guarda de prefixo de qualquer forma; com o nome visível, a apresentação deixa de ser necessária.

## Objeções da revisão que alteram a SPEC

| # | Mudança em relação à SPEC |
|---|---|
| O1 | **O autor gravado é o perfil autenticado nos DOIS modos.** A SPEC preservava a precedência do `author_name` do navegador com o interruptor desligado; medido que o único emissor é o compositor (`TenantConversationsPage.tsx:279,318`), que manda o mesmo cálculo do servidor. Manter a precedência só preservaria o vetor — a IA lê esse campo (`aiReply.ts:168`) e o interruptor nasce desligado em todos. |
| O2 | O teto de legenda vale **sempre**, e fica declarado: hoje `content` aceita 4.000 e vira caption. Adotar 1.024 para legenda (limite do WhatsApp), aplicado depois do prefixo, nos dois modos. |
| O3 | Legenda de mídia é **contrato de API sem consumidor na tela** — `sendAttachmentMutation.mutate({ kind, file })` (linha 589) nunca passa `caption`. Implementar e testar, sem prometer que aparece no produto. |
| O4 | Excluir o e-mail como identidade exige **passo de dados na implantação**: conferir nome/apelido de todos os perfis antes de ligar. Entra no checklist de ativação. |
| O5 | Sem ferramenta de grafo de imports no repo (nem `madge`, nem `dependency-cruiser`, nem `ts-morph`). O teste de fronteira é **comportamental** + verificação de `import` por regex. E a lista está corrigida: **a cutucada não tem caminho próprio** — `idleNudgeRunner.ts` envia por `executeConversationAIReply`. |
| O6 | A reordenação da rota (replay antes de resolver thread/anexo) vai para a **trilha 2**: hoje o replay é detectado por conflito de INSERT dentro do dispatcher (`dispatchConversationOutbound.ts:191-198`). |
| O7 | Trilhas separadas — decisão 1 acima. |
| O8 | Corrigir o override otimista **também no `aiEnabled`** (`TenantChannelsPage.tsx:730` só limpa no `catch`), senão fica um certo e um errado no mesmo card. |

**Snapshot (pergunta 2 do Codex):** versão barata. Grava-se **ator, nome aplicado e versão do formato**, não o texto planejado. O texto inteiro só é necessário para exportação fiel, que a própria SPEC põe fora do escopo.

## Caminhos de envio externo — mapa medido

Cinco, e só o primeiro assina:

| Caminho | Assina? |
|---|---|
| `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts` | **sim**, quando ligado |
| `app/api/platform/tenants/[tenantId]/channels/[connectionId]/send-test/route.ts` | não |
| `lib/automations/executor.ts` | não |
| `lib/conversations/aiReply.ts` (cobre IA **e cutucada**) | não |
| `lib/conversations/meetingReminder.ts` | não |

`lib/conversations/conversationMedia.ts` é chamado pelo manual; não decide nada sozinho.

## Fatias desta entrega

Cada fatia é um commit, com teste escrito antes.

1. **Função pura** — `lib/conversations/assinaturaAtendente.ts`: decide o texto assinado e lê o interruptor. Sem guarda heurística. Normalização por `\p{M}` (não usar `[̀-ͯ]`: a ferramenta de escrita converte o escape).
2. **Autor autenticado sempre** — a rota passa a gravar o perfil autenticado em `author_name` e a registrar ator + nome + versão em metadado do servidor, com o payload do navegador incapaz de sobrescrever.
3. **Assinatura no envio** — aplica o texto assinado só no que vai à Evolution (texto e legenda), com os tetos de 4.000 / 1.024 medidos **depois** do prefixo. Recusa áudio externo acompanhado de texto antes de qualquer efeito. Recusa envio com assinatura ligada e perfil sem nome utilizável.
4. **Campo `signManualReplies`** — schema e merge do PATCH da conexão. Lembrar: o objeto `config` **não** é `.strict()`, então antes desta fatia um campo desconhecido é ignorado, não rejeitado.
5. **Interruptor na tela** — tela de canais, com reconciliação pelo valor confirmado do servidor; corrigir o mesmo defeito no `aiEnabled`.
6. **Atribuição na caixa** — nome do remetente na bolha de saída, busca pelo último autor, e rótulo de roteamento que não confunde responsável com quem falou.
7. **Fronteira** — teste comportamental provando que o payload da IA não muda com o interruptor ligado, mais verificação de que nenhum dos quatro caminhos automáticos importa o módulo de assinatura.

## Fora desta entrega

- **Trilha 2 (correções globais de envio):** chave estável de retry com upload único, vínculo chave–payload, replay sem novos efeitos, estados de entrega incerta, e a reordenação da rota.
- Botão "Assumir atendimento" e claim atômico — SPEC própria.
- Resposta pelo aparelho, mídia sem legenda, envio composto de áudio+texto, exportação fiel, backfill.
- Preview da assinatura no compositor: o inbox não carrega o config da conexão (`THREAD_SELECT` traz só `id, name, status`).

## Checklist de ativação (não faz parte da entrega)

Antes de ligar o interruptor em qualquer cliente:

1. Trilha 2 concluída.
2. Todos os perfis do tenant com nome ou apelido preenchido — sem isso o envio falha por desenho (O4).
3. Simular webhook de saída antes, durante e depois da confirmação do provider, para descartar eco com prefixo (risco condicional da SPEC, sem evidência observada).

## Validação

- Suíte completa e `tsc`, lidos em comando **separado** antes de qualquer commit.
- Testes com banco: Supabase local apenas.
- Sem push, sem deploy, sem migration aplicada. O repositório exige revisão do diff e aprovação do Junior.
