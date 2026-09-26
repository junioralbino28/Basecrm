# PLAN — Trilha 2: correções globais de envio manual

> Base: seção "Correções globais" da `SPEC.md` + itens O6/O7 da revisão. Autorizada pelo Junior em 25/09
> ("pode seguir para a trilha 2"), como pré-requisito para LIGAR a assinatura — a entrega 1 já está
> commitada com o interruptor desligado. Commit local apenas; sem push, sem deploy.

## O que a medição fixou (26/09)

- A unicidade da chave é `(organization_id, idempotency_key)` — índice parcial da migration
  `20260718020000_funil_f3_outbox.sql:114`. A consulta prévia usa exatamente esse par.
- A tela **não manda chave**: `sendMessageMutation.mutationFn` monta o body só com o composer, e a
  rota gera `manual:<threadId>:<uuid>` novo a cada POST (`messages/route.ts`). É daí que nasce a
  duplicata do retry.
- No `onError` o composer **já preserva o texto**. O rascunho não se perde; o que falta é a CHAVE
  estável para o segundo clique não virar segunda mensagem.
- O replay hoje só é detectado por conflito de INSERT dentro do dispatcher
  (`dispatchConversationOutbound.ts:187-203`) — depois de a rota já ter pausado automação e, no fim,
  ela ainda atualiza preview/status da thread com o corpo do SEGUNDO POST.
- O warning de 201 trata `failed` e `unknown` com a mesma frase "o envio pela Evolution falhou" —
  a conversão de incerteza em falha que a SPEC veta.

## Desenho

**Fingerprint do pedido lógico** (`lib/conversations/idempotenciaManual.ts`, novo): sha256 de
`[organizationId, threadId, atorId, direction, content, attachmentPath, sendExternal]`. Gravado em
`metadata.intencao = { versao: 1, hash }` no momento da criação, DEPOIS do spread do metadata do
navegador (mesma proteção do `atendente`). A configuração da assinatura e o nome ficam FORA do
fingerprint de propósito: replay com o interruptor mudado ainda é o mesmo pedido (SPEC, linha 78).

**Replay antes de qualquer efeito**: com `direction=outbound` e chave vinda do cliente, a rota
consulta `(org, chave)` logo depois de carregar a thread — antes das validações da entrega 1, antes
da pausa de automação, antes do signed URL do anexo. Achou a linha:
- fingerprint diferente → **409**, sem nenhum efeito;
- igual → **200 `replayed: true`** com a linha original + thread ATUAL (sem update), warning derivado
  do `delivery_status` da linha (`pending` reutiliza a frase do dispatcher, exportada como constante).
Linha legada sem `metadata.intencao` (só as chaves `manual:<uuid>` que nunca voltam): compara
`thread_id` e pronto — ramo praticamente morto, documentado no código.

**Corrida** (dois POSTs simultâneos com a mesma chave passam pela consulta prévia sem achar nada):
o INSERT decide, o perdedor recebe `duplicate: true` do dispatcher, e a rota então confere o
fingerprint da linha vencedora — 409 se diverge; resposta de replay SEM update de thread se igual.
A pausa de automação do perdedor já rodou nesse caminho: é idempotente e é o mesmo efeito que o
vencedor causou; aceito e comentado no código.

**Chave estável na tela** (`lib/conversations/intencaoDeEnvio.ts`, novo, puro):
- gera `manual:<threadId>:<uuid>` quando a intenção nasce, reutiliza enquanto o pedido for o MESMO
  (corpo+direção+anexo), troca quando o pedido muda, limpa no sucesso;
- persiste em `sessionStorage` com try/catch e fallback em memória (privado/bloqueado não quebra);
- ao abrir a conversa com intenção pendente e composer vazio, restaura o texto e a chave — é isso
  que faz a chave sobreviver a recarregamento;
- anexo: o `file_path` do primeiro upload fica congelado em memória por thread (marca
  `nome:tamanho:lastModified`); retry do POST reutiliza o MESMO arquivo e a MESMA chave, sem segundo
  upload. Após reload o `File` não existe mais — upload congelado vale dentro da página, declarado.

**Entrega incerta**: a rota devolve `delivery_status`; o texto do feedback sai de uma função pura
(`feedbackDoEnvio`) — `failed` diz "não chegou, pode tentar de novo"; `unknown`/`pending` diz "sem
confirmação — NÃO reenvie antes de conferir se chegou". O append no cache passa a checar `id` para
replay não duplicar a bolha.

**Fora**: nota interna continua sem idempotência (não passa pelo dispatcher hoje); reenvio
automático não existe em nenhum estado; exportação/backfill não entram.

## Fatias (1 commit cada, teste antes)

1. `idempotenciaManual.ts` + testes puros; `PENDING_REVIEW_WARNING` exportada do dispatcher.
2. Rota: consulta prévia, 409, replay 200, caminho `duplicate`, `metadata.intencao`,
   `delivery_status` na resposta — `route.idempotencia.test.ts` com o harness do teste da assinatura.
3. `feedbackDoEnvio` + tela distinguindo falha de incerteza + append por id.
4. `intencaoDeEnvio.ts` + fiação na tela (texto e anexo) + restauração ao abrir a conversa.

**Lacuna declarada**: o mock de `useMutation` do teste da página não executa `mutationFn`, então o
body do fetch não é observável ali; a fiação é provada por spy no módulo + testes de rota, e o
fim-a-fim fica para a prévia.

## Validação

Suíte completa e `tsc` lidos em comando separado; a falha preexistente conhecida é
`lib/googleCalendar/oauthState.test.ts` (provada alheia na entrega 1). Sem push.
