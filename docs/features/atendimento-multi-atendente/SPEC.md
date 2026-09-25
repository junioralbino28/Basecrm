# SPEC — Identidade do atendente humano no WhatsApp

> Status: **PROPOSTA para revisão do Claude e aprovação do Junior**. Não implementar ainda.
> Data: 25/09/2026. Base de leitura: worktree feat/aurora-implantacao, HEAD f30868d.
> Substitui, como decisão de produto, o rascunho de plano em docs/spec-atendimento-multi-atendente.md. Após aprovação, escrever um PLAN técnico separado.

## Problema e resultado esperado

Um mesmo número de WhatsApp pode ser atendido pela IA e por várias pessoas no CRM. Quando uma pessoa responde pela tela, o lead deve identificar **quem enviou aquela mensagem**, sem trocar de número. O nome deve corresponder ao usuário autenticado que realmente enviou, não ao responsável atualmente atribuído à conversa nem a um campo livre do navegador.

O recurso é do produto inteiro: toda conexão ganha a mesma configuração, inicialmente desligada. A configuração é **por número**, não uma implementação especial por cliente. Com ela desligada, o texto externo continua como hoje. A correção de bugs de envio listada abaixo é global e está declarada separadamente; não se esconde atrás desse interruptor.

## Decisões do Junior que esta SPEC não reabre

1. Não enviar aviso de troca de atendente.
2. A assinatura é exclusiva de respostas humanas manuais. Aurora, Julia, lembrete, cutucada, automação e teste de conexão não recebem prefixo nem mudança de texto.
3. Não criar feature flag nem ramificações de código por cliente. Campo universal; ausência do campo equivale a desligado.

## Decisões de desenho desta proposta

| Questão | Decisão | Motivo |
|---|---|---|
| Novo botão “Assumir” do rascunho | **Fora desta entrega; manter os controles atuais** | Assinar cada mensagem não depende de proprietário exclusivo. O PATCH atual não garante claim atômico nem autoriza agência como responsável do tenant. Um botão que prometa assumir seria enganoso. |
| Fonte do nome no WhatsApp | Perfil autenticado lido no servidor no momento do envio | O campo author_name do navegador pode estar desatualizado ou ser adulterado. |
| Corpo salvo no CRM | Sem prefixo automático | A IA já recebe autor e conteúdo em campos separados. |
| Guarda “já começa com meu nome” | **Não usar** | Confunde conteúdo legítimo com assinatura e deixa passar assinaturas formatadas de outra forma. |
| Rastreabilidade | Congelar ator, nome e payload externo planejado na própria mensagem | Só guardar o nome não prova exatamente o texto/caption preparado para a Evolution. “Planejado” não significa entregue nem lido. |
| Mídia sem legenda | Não criar legenda nem texto adicional | Mantém o comportamento atual; essa mensagem não mostrará o nome ao lead. É exceção explícita do objetivo. |
| Áudio com texto/legenda | Recusar antes de criar envio, com erro claro, até existir fluxo próprio | O caminho atual de áudio descarta a legenda e pode registrar sucesso falso. |

### Alternativa descartada: botão novo sem operação atômica

O rascunho faria dois atendentes receberem sucesso ao clicar quase juntos, com o último sobrescrevendo o primeiro; para o admin da agência, mudaria só o status e conservaria outro responsável. Não basta trocar o texto do botão. Uma futura SPEC de claim deve definir permissão de resposta no servidor, ator do próprio tenant, atualização atômica de status e responsável, conflito 409 para o perdedor e semântica separada para a agência. Até lá, “responsável atribuído” é dado de roteamento, não prova de quem escreveu uma mensagem.

## Escopo funcional desta entrega

### 1. Configuração universal do número

- Acrescentar signManualReplies, booleano opcional, à configuração de cada conexão. Somente true ativa a assinatura; ausente, null, false ou valor legado inválido significam desligado.
- O PATCH de conexão aceita apenas booleano para o campo novo e mescla sem apagar as demais opções. A leitura pública existente deve repassá-lo sem segredos.
- A tela de canais mostra “Assinar respostas humanas com o nome do atendente”, inicialmente desligado. Só quem já pode gerenciar a conexão pode alterá-lo.
- O controle precisa reconciliar com o valor **confirmado pelo servidor** após salvar. Um override otimista não pode ficar permanente. Se PATCH funcionar e a recarga falhar, a tela não deve fingir que a leitura posterior foi confirmada; deve usar a resposta canônica do PATCH ou mostrar estado incerto e permitir nova sincronização.
- Nenhuma indicação no compositor depende desta configuração nesta versão: o inbox atualmente não carrega o config da conexão selecionada. Não inventar preview “sairá como...” sem mudar esse contrato.

### 2. Identidade e assinatura de uma resposta manual

- A decisão de assinar é tomada no servidor, para a conexão da própria thread, **antes** de reservar/persistir o envio pendente. A mesma decisão e o mesmo nome valem do começo ao fim daquela tentativa, inclusive se o interruptor ou o perfil mudarem depois.
- A rota manual resolve o nome a partir do perfil autenticado: apelido não vazio; senão nome e sobrenome disponíveis. Um fallback genérico como “Sem nome” não é identidade válida. Com assinatura ligada e sem nome utilizável, não enviar externamente; devolver erro claro para completar o perfil.
- Para texto externo com a opção ligada, o payload preparado é “Nome: corpo”. A função não tenta reconhecer assinatura digitada pelo usuário. Se alguém digitar “Nome: ...” no corpo, esse texto continua sendo corpo e receberá o prefixo automático. A interface pode orientar a digitar apenas a mensagem; não deve remover conteúdo por heurística.
- Aplicar a assinatura somente ao texto externo ou à legenda não vazia de imagem, vídeo e documento. O corpo lógico persistido permanece sem o prefixo automático. Usar teto **da aplicação**, incluindo prefixo, de 4.000 unidades UTF-16 para texto e 1.000 para legenda; se o adaptador documentar limite inferior do provedor, prevalece o menor. Esses números não são afirmação sobre o limite da Meta/Evolution.
- Nota interna, envio apenas local, mídia sem legenda, mensagens automáticas e eco de resposta feita pelo aparelho não ganham prefixo. Responder pelo aparelho segue fora do alcance: o CRM vê o eco depois da entrega. A criação de legendas na tela de anexos fica fora desta entrega; os casos com legenda são contrato da API e devem ser testados na rota.
- Com a opção ligada em um envio humano externo, author_name persistido e último autor do preview devem corresponder ao perfil autenticado, mesmo que o navegador envie outro author_name. Quando há texto ou legenda assinada, o nome no payload também corresponde a esse perfil; mídia sem legenda não contém nome externo. O valor livre do navegador nunca é autoridade para assinar.
- Com a opção desligada, preservar a precedência atual de author_name do payload sobre o fallback do perfil e não alterar o texto externo. Nesse modo, author_name da linha é legado e **não é prova de identidade**; o ator autenticado fica no metadado reservado. Notas internas preservam o fluxo atual. Essa compatibilidade não autoriza uma identidade falsa quando a assinatura estiver ligada.
- Em toda nova mensagem manual de **saída**, inclusive envio apenas local, registrar em metadado reservado do servidor o ID do ator autenticado e o nome resolvido. Nota interna não é saída e fica no fluxo atual. Campos do payload do navegador não podem sobrescrever esse metadado.
- A ordem da rota deve ser: autenticar e interpretar o pedido; identificar replay pela chave e comparar o pedido lógico original; se for replay válido, devolver a linha original **sem depender de perfil, conexão, arquivo ou configuração atuais**; se for intenção nova, resolver thread/conexão/anexo, validar nome, tipo de mídia e tamanho do payload; só então reservar o envio e executar efeitos como pausa de automação. Rejeição 4xx não cria mensagem nem pausa automação.

### 3. Registro auditável sem confundir tentativa e entrega

- No registro da tentativa, congelar: ID do ator, nome aplicado ou motivo de não aplicação, versão do formato e texto/legenda **planejado para a Evolution**, quando existir. O conteúdo lógico permanece separado. O snapshot é imutável após a reserva da tentativa.
- Não usar nomes como “texto entregue” ou “texto lido”: aceite da API, status incerto e leitura pelo lead são estados diferentes. Para envio apenas local, não há payload externo planejado. Não copiar segredos nem resposta bruta do provedor para o snapshot.
- O snapshot textual duplica conteúdo potencialmente pessoal na mesma linha. Deve herdar isolamento por tenant, RLS, retenção e controles de acesso da mensagem; não aparecer em logs, erros públicos ou DTOs que não precisem dele. Esse custo de armazenamento/privacidade é aceito aqui para permitir conferência do payload efetivamente preparado.
- O metadado serve para conferir o que o CRM tentou enviar, mesmo após mudança de apelido ou do interruptor. Relatório/exportação de transcrição fiel não entra nesta entrega; se for criado depois, deve usar esse snapshot e o status da entrega, não reconstruir a partir da configuração atual.
- A leitura da IA continua usando conteúdo sem prefixo e autor em campo próprio. Nenhum contexto da IA deve receber “Vitória: Vitória: ...” por inserção automática no conteúdo salvo.

### 4. Caixa de conversas

- Bolhas de **novos envios manuais** mostram o nome do ator registrado no servidor, com assinatura ligada ou desligada. Mensagens históricas sem esse metadado não são retroativamente atribuídas; podem conservar a apresentação atual. Bolhas automáticas preservam a apresentação atual.
- Preview e busca de **novos envios manuais** usam o ator autenticado, mesmo com o interruptor desligado; no modo desligado, isso é uma correção global de atribuição do preview, enquanto author_name da linha mantém a compatibilidade descrita acima. A busca local considera esse último autor além dos campos atuais. Se Vitória enviou a última resposta e a conversa foi atribuída a outra pessoa, pesquisar “Vitória” deve encontrá-la. Quando a última mensagem muda, preview/autor devem passar a refletir a mensagem nova, sem nome manual obsoleto.
- O rótulo de roteamento não deve confundir responsável atribuído com quem falou. Em human_active com Ana atribuída e agência respondendo, mostrar “Atendimento humano · Responsável: Ana”, não “Em atendimento humano por Ana”. Em human_active sem responsável, mostrar “Atendimento humano · Sem responsável atribuído”, nunca “IA pode responder”.
- O número de saída permanece o número da conexão vinculada à thread. Não adicionar mensagem de sistema anunciando transferência.
- Quem acessa como agência pode responder conforme suas permissões e terá o **próprio** nome na mensagem. Isso não altera o responsável do tenant nem afirma que a agência “assumiu” a atribuição.

## Correções globais de envio exigidas antes de ligar o recurso

Estas falhas já existem, mas ficariam mais difíceis de explicar ao lead durante a estreia da assinatura. São trabalho transversal, não exceções por cliente.

1. **Retry de uma mesma intenção:** a tela cria uma chave estável para a tentativa lógica e a reutiliza após timeout/perda da resposta HTTP, inclusive após remontagem ou recarregamento da página enquanto a intenção estiver pendente. Nova mensagem deliberada recebe chave nova. A chave não é recalculada por mudança posterior de apelido ou interruptor. Para anexo, congelar também o corpo e o file_path retornado pelo primeiro upload: retry do POST reutiliza **o mesmo arquivo**, sem fazer segundo upload.
2. **Vínculo chave–payload:** o servidor vincula a chave ao pedido lógico original (tenant, thread, ator, corpo, anexo e modo de envio). Mesmo valor com pedido diferente retorna conflito, sem chamar a Evolution. Mesmo valor com pedido idêntico retorna a tentativa existente, mesmo que a configuração tenha mudado. Não assinar nem enviar de novo.
3. **Replay sem novos efeitos:** resposta duplicada não pausa automação outra vez, não altera status/preview com dados do segundo POST e não regrava o snapshot. Preview e resposta devem refletir a mensagem persistida original.
   Se a pausa da automação falhar na tentativa nova, não enviar ao provider nem deixar a linha parecendo enviada; registrar falha recuperável sem transformar o replay da mesma chave em um segundo envio.
4. **Entrega incerta:** status pending/unknown não dispara reenvio cego. A API, os tipos e a bolha distinguem esses estados de “failed”; a interface não apaga automaticamente o rascunho nem converte incerteza em “Evolution falhou”. Uma decisão explícita de enviar outra mensagem cria nova intenção/chave somente depois de o operador avaliar o risco de duplicação.
5. **Áudio externo acompanhado de texto:** enquanto o provider de áudio não aceitar legenda e não existir envio composto seguro, rejeitar esse pedido antes de registrar “enviado”. Envio apenas local não passa pelo provider e conserva o fluxo atual. Áudio puro continua possível e sem assinatura visível. Imagem, vídeo e documento com legenda continuam enviando a legenda assinada quando a opção estiver ligada.

## Contrato resumido por cenário

| Cenário | Payload externo | Conteúdo/autor no CRM |
|---|---|---|
| Humano, texto, opção ligada | “Nome: corpo” | Corpo sem prefixo automático; autor autenticado; snapshot do payload planejado |
| Humano, texto, opção desligada | Corpo como hoje | Comportamento legado de conteúdo/author_name; ator autenticado em metadado reservado |
| Humano, imagem/vídeo/documento com legenda, opção ligada | Mídia com “Nome: legenda” | Legenda lógica; autor autenticado; snapshot da legenda planejada |
| Humano, mídia sem legenda | Mídia sem texto adicional | Sem assinatura externa; ator registrado internamente |
| Humano, áudio externo com texto | Nenhum envio; erro de validação | Nenhuma linha criada ou marcada como enviada |
| Nota interna | Nenhum payload externo | Fluxo atual; sem assinatura aplicada |
| Envio apenas local | Nenhum payload externo | Conteúdo/autor legados; ator autenticado em metadado; sem assinatura aplicada |
| IA, cutucada, lembrete, automação, teste de conexão | Exatamente o fluxo atual | Sem mudança por este recurso |
| Resposta no aparelho | Texto já enviado pelo aparelho | Eco tratado pelo webhook; sem assinatura retroativa |

## Critérios de aceite e testes obrigatórios

1. Ausência do campo na conexão mantém o texto externo igual ao atual. true liga; false desliga; PATCH não apaga configuração adjacente e rejeita tipo inválido.
2. Dois atendentes respondem, em sequência, pelo **mesmo número**: cada texto mostra o nome de quem autenticou aquele envio; CRM e preview atribuem corretamente cada mensagem. O responsável atribuído pode ser outra pessoa.
3. POST malicioso ou aba antiga manda author_name diferente do perfil. Com assinatura ligada, payload, author_name persistido, bolha e último autor usam o perfil autenticado. Com assinatura desligada, a compatibilidade definida acima permanece.
4. Corpo iniciado por “Rio:” ou por qualquer outro nome é tratado como corpo; não existe deduplicação por aparência. Corpo com nome digitado pelo próprio atendente não corrompe o conteúdo lógico salvo.
5. Imagem, vídeo e documento com legenda preservam a legenda assinada; sem legenda não criam uma. A tela de anexos pode continuar sem campo de legenda. Áudio externo com texto falha antes de qualquer envio, pausa de automação ou linha “sent”.
6. Texto acima de 4.000 ou legenda acima de 1.000 unidades UTF-16 **depois do prefixo** falha antes de reservar envio; testar bordas exatas. Perfil sem nome válido falha com instrução de corrigir o perfil, sem mensagem anônima surpresa e sem efeitos na thread.
7. Retry idêntico com a mesma chave, inclusive após mudar o interruptor, remover o nome do perfil ou remover o arquivo/conexão original, retorna a tentativa anterior sem novo envio ou efeito de thread. Payload diferente com a mesma chave retorna conflito e não muda preview. Timeout desconhecido não provoca resend automático. Para anexo, testar um único upload e dois POSTs com mesmo file_path e chave.
8. Busca encontra a conversa pelo ator da última mensagem manual mesmo com a assinatura desligada e após troca de responsável. Rótulo human_active é honesto com responsável diferente do autor e com responsável ausente. Bolha da IA e texto enviado pela IA não mudam com o interruptor ligado.
9. Toggle da tela reflete valor confirmado do servidor; testar PATCH bem-sucedido com GET seguinte falhando e mudança remota feita por outra aba.
10. Teste de fronteira verifica o **grafo de imports** dos caminhos automáticos, não a presença de uma palavra em arquivo-fonte, e teste comportamental verifica o payload real da IA com a opção ligada. Imports locais não resolvidos falham no teste. O teste deve cobrir resposta da IA, cutucada, lembrete, automação e teste de conexão.
11. Testes de UI não substituem contrato da API: fixtures de IDs usam UUIDs válidos; mocks não devem dar falso positivo. Validar rotas, dispatcher, mídia e UI isoladamente, depois regressão integrada em ambiente local. Testar leitura pública da configuração com true/false/ausente e preservação da remoção de segredos.

## Risco condicional a verificar antes de ativar em produção

Não há evidência de que a instância Evolution atual faça eco de mensagens enviadas pela própria API; há registro de respostas da IA sem eco. Mesmo assim, simular webhook de saída antes, durante e depois da confirmação do provider. Se ocorrer eco antes de gravar o provider_message_id, corrigir a correlação/deduplicação **antes** da ativação. Não tratar esse risco como bug observado nem considerar prefixo repetido no WhatsApp sem reproduzi-lo.

## Fora desta entrega / próximo incremento

- Botão novo de claim “Assumir atendimento”, transferência formal de responsável e prevenção de dois claims simultâneos. Requer SPEC própria com operação atômica e permissões; os controles atuais permanecem.
- O PATCH atual de status/responsável ainda exige somente permissão de acesso e pode marcar human_active sem que o usuário possa responder. Sem botão novo, este defeito preexistente não é criado por esta entrega; deve ganhar correção própria de permissões. Não apresentar human_active como prova de que há um atendente apto.
- Identificação em resposta enviada diretamente pelo aparelho ou em mídia sem legenda.
- Envio composto de áudio mais texto, em vez da rejeição segura definida acima.
- Exportação fiel de conversas, relatórios por atendente e backfill de mensagens antigas.
- Preview da assinatura no compositor: exige carregar config da conexão no inbox, ausente no contrato atual.
- Agenda, duração de reunião e configuração de agentes por funil, assuntos independentes do nome de quem respondeu.

## Validação, governança e entrega

- Primeiro revisar esta SPEC com o Claude e obter aprovação do Junior. Só depois escrever PLAN técnico/TDD. Não copiar blocos executáveis do rascunho antigo.
- Testes de rota/provider usam mocks; nenhuma chamada real à Evolution e nenhuma query/teste no banco de produção. Testes com banco usam **apenas Supabase local** e precisam confirmar explicitamente alvo local/loopback; o guard existente admite branch remota mediante configuração e sozinho não prova isso. Não usar npm run dev puro porque .env.local aponta para produção.
- Validar lint, tipos, testes relevantes e regressão completa; relatar resultados reais, sem contagem prevista de testes nem mensagem de falha suposta. A validação do novo campo não deve pressupor que o objeto config de Zod é strict.
- Nenhum push, deploy, migração aplicada em produção ou ativação do interruptor decorre da aprovação desta SPEC. O repositório exige revisão do diff pelo Claude e aprovação do Junior antes de subir qualquer coisa.

## Pontos para o Claude aprovar ou contestar

1. Concorda que a identidade por mensagem sai agora **sem** o novo botão de claim?
2. O snapshot de payload **planejado**, com estado de entrega separado, está suficiente e usa o menor escopo de metadado seguro para este CRM?
3. As correções globais de retry e áudio devem ser executadas como pré-requisito nesta mesma entrega, mantendo a assinatura desligada até passarem?
4. Há algum caminho manual de envio fora da rota mapeada ou algum efeito de webhook não coberto pelos testes propostos?
5. O Junior aceita a consequência de não tentar adivinhar assinatura digitada à mão (ela poderá ficar duplicada) e a exceção de mídia sem legenda não mostrar nome ao lead?
