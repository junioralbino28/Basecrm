# IMPL-LOG — C1B (fatia visível do construtor)

Data: 2026-07-20  
Branch: `feat/funil-construtor`  
Escopo executado: T0 e R1, R4, R5, R6 e R7 de `SPEC-ENTREGA-C.md`.

## Resultado

A C1B foi concluída como a fatia visual e operável prevista:

- o fluxo é exibido como árvore com layout automático, pai centralizado entre
  primeiro e último filho e rótulos de condição presos às curvas;
- o mapa pode ser arrastado em todas as direções, aplica zoom ancorado no cursor,
  respeita o piso de 70% e volta ao enquadramento pelo botão `Ajustar`;
- o clique no passo usa captura tardia e abre uma doca contextual; arrastar o mapa
  não vira clique no cartão;
- mensagens abrem uma doca alta com editor e biblioteca; esperas abrem uma doca
  compacta;
- a doca fecha por `×`, `Esc` e clique no fundo;
- o seletor de automação e o gatilho ficam na barra superior, fora do mapa;
- o gatilho novo expõe uma fronteira substituível
  `service-tag-entity-v3`, sem consolidar texto livre de `deals.tags`;
- o botão desabilitado explica o campo ausente, a biblioteca vazia orienta o
  primeiro uso, apenas mensagens exibem o canal e a falha fica presa ao passo;
- a publicação cria uma versão, mas o envio real continua bloqueado.

R2 e R3 não foram implementados. Não existe mover soltando na linha nesta
entrega, e a C1C não foi iniciada.

## Commits

| Tarefa | Commit | Descrição |
| --- | --- | --- |
| T0 | `91fcd31` | `test(funil): torna saude do tick reexecutavel` |
| R1 | `cefdf40` | `feat(funil): renderiza fluxo em arvore automatica` |
| R5 | `f27cff0` | `feat(funil): adiciona navegacao segura ao mapa` |
| R4 | `291ac60` | `feat(funil): adiciona doca contextual de edicao` |
| R6 | `ba7a130` | `feat(funil): move automacao e gatilho para barra superior` |
| R7 | `6602434` | `fix(funil): aplica correcoes de uso no construtor` |
| Aceite local | `6a6be0f` | `fix(dev): executa ambiente local no Windows` |
| Aceite visual | `8c656d5` | `fix(ui): evita divergencia de tema na hidratacao` |

## Evidências de TDD e verificação

- T0 foi executado duas vezes seguidas contra o mesmo Supabase local, sem
  `db reset`: 5 testes passando em cada execução;
- testes focados da C1B, do layout e do inicializador local: 25 passando,
  0 falhas;
- TypeScript isolado: verde;
- `npm run precheck:fast`: lint e TypeScript verdes; 668 testes passando,
  125 ignorados e 0 falhas.

O aceite no navegador usou Chrome em 1600 × 900, credencial e organização
efêmeras criadas somente no Supabase local. A jornada confirmou:

- criação da automação e edição inline da primeira mensagem;
- fechamento da doca por `Esc`, clique no vazio e `×`;
- busca de ação pelo botão `+`;
- criação de `Aguardar resposta` com os caminhos `respondeu` e
  `não respondeu`;
- persistência do rascunho após recarregar a página;
- pan, zoom ancorado, piso de 70% e `Ajustar`;
- publicação da versão 1 com a mensagem
  `O envio real continua bloqueado`;
- modal de teste em simulação e orientação quando não há conversa elegível;
- ausência do overlay de erro do Next após a correção de hidratação.

A organização, a automação e todos os usuários efêmeros foram removidos ao fim
do aceite. O coletor opcional de telemetria local em `127.0.0.1:7242` não estava
aberto e gerou recusas no console; não houve falha funcional da aplicação.

## Correções encontradas durante o aceite

1. `npm run dev:local` falhava no Windows com `EINVAL` ao chamar `npx.cmd`.
   A invocação agora passa pelo `ComSpec`, preservando as travas que confirmam
   Supabase local, safe mode e modo de entrega em simulação.
2. O ícone de tema lia a preferência do navegador antes da hidratação e podia
   divergir do HTML do servidor. O primeiro render agora é determinístico e há
   teste de regressão por renderização SSR.

## Segurança operacional

- Somente o Supabase local em `127.0.0.1:54321` foi usado.
- O ref de produção `eqidsihasmwwamkaqfka` não foi acessado.
- `automation_live_enabled` permaneceu `false`.
- `delivery_mode` permaneceu `simulation`.
- Não houve push nem deploy.

## Roteiro para o Junior no localhost

1. No terminal do repositório, rode `npm run dev:local`.
2. Abra `http://localhost:3000` no Chrome e entre com sua credencial de teste.
3. No menu esquerdo, clique em **Automações**.
4. Clique em **Nova automação**, dê um nome e clique em
   **Criar automação**.
5. Clique no cartão **Mensagem sem conteúdo**. A doca alta abre abaixo do mapa.
   Escreva a mensagem no editor. Se a biblioteca ainda estiver vazia, ela mostra
   como salvar a primeira mensagem; o botão informa exatamente quais campos
   faltam.
6. Feche a doca por `Esc`, pelo `×` ou clicando no fundo escuro do mapa.
7. Clique no `+` ao lado do cartão, pesquise **resposta** e escolha
   **Aguardar resposta**. A árvore cria e rotula os caminhos
   **respondeu** e **não respondeu**.
8. Arraste o fundo para mover o mapa, use a roda do mouse para aplicar zoom e
   clique em **Ajustar** para reenquadrar a árvore.
9. Clique em **Salvar** e recarregue a página se quiser confirmar a persistência.
10. Clique em **Publicar**. A automação fica **Publicada**, mas a tela confirma
    que o envio real continua bloqueado.
11. Clique em **Testar**. Se o banco local não tiver uma conversa com contato,
    oportunidade e WhatsApp vinculados, o modal explica o que falta; quando
    houver uma, o teste continua sendo apenas simulação.

O texto `gatilho de serviço ainda não selecionado` é intencional nesta fatia.
Ele é a fronteira para o seletor de entidades UUID + schemaVersion 3 da C2, sem
introduzir agora um seletor textual que teria de ser desfeito.

