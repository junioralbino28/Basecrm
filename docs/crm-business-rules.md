# CRM Business Rules

## Objetivo

Registrar regras de negocio ja consolidadas no BaseCRM para evitar que mudancas de UI ou arquitetura reintroduzam erros conceituais.

Este documento descreve o que o sistema `deve fazer` no estado atual, com foco em:

- clinica
- boards
- atendimento
- papeis e acessos

## Regras de Tenant

1. Uma clinica e uma `organization`.
2. O usuario da clinica opera apenas a propria `organization`.
3. O usuario da agencia pode operar varias clinicas.
4. Toda operacao de CRM da clinica deve ocorrer dentro de um contexto de clinica ativa.

## Regras de Workspace

1. `Platform Admin` pertence ao contexto da agencia.
2. `Boards`, `Contatos`, `Atividades`, `Settings`, `WhatsApp` e `Conversations` pertencem ao contexto da clinica.
3. Entrar numa clinica deve carregar o workspace dela.
4. O nome principal do workspace deve ser o da clinica, nao o do usuario.

## Regras de Board e Funil

1. Uma clinica pode ter mais de um board.
2. Trocar clinica e diferente de trocar board.
3. O seletor de clinica escolhe a conta ativa.
4. O seletor de board escolhe o funil da clinica ativa.
5. Board nunca deve ser usado como substituto do contexto da clinica.

## Regras de Protecao do Funil em Producao

Enquanto a automacao comercial completa nao estiver finalizada, o funil da empresa continua sendo protegido como fonte principal da operacao comercial.

Regras:

1. A IA de atendimento nao movimenta automaticamente oportunidades no MVP inicial.
2. A IA de atendimento nao cria follow-up automatico no MVP inicial.
3. A IA de atendimento nao altera estrutura de funil, etapas ou automacoes da empresa em uso.
4. No MVP imediato, a IA atua sobre `Conversas`, resumo e handoff, nao sobre a logica do pipeline.
5. Qualquer futura automacao de funil deve entrar por configuracao explicita, validacao da agencia e aprovacoes claras.

Objetivo:

- evitar bagunca no funil ativo da empresa
- evitar relatorios contaminados por automacoes incompletas
- permitir evolucao futura de pipeline sem interromper a operacao comercial atual

## Regras de Permissao

1. Papel define escopo.
2. Permissao granular define poder operacional.
3. `agency_admin` pode editar cargo e permissoes.
4. `agency_staff` deve receber acesso customizavel.
5. `clinic_admin` administra a propria clinica.
6. `clinic_staff` opera a clinica dentro das permissoes recebidas.

## Regras de Equipe

1. A agencia pode criar acessos para usuarios da agencia e da clinica.
2. O dono da clinica pode receber `clinic_admin`.
3. A atendente pode receber `clinic_staff`.
4. Promocao e mudanca de cargo devem ser editaveis depois.

## Regras de WhatsApp

1. O numero de WhatsApp pertence a clinica.
2. A conexao do canal pertence ao tenant da clinica.
3. Usuarios com `whatsapp.access` podem abrir o modulo e operar reconexao/teste.
4. Usuarios com `whatsapp.manage_connection` podem editar configuracao estrutural.

## Regras de Conversations

1. Conversations pertence ao tenant da clinica.
2. O inbox organiza o atendimento por thread.
3. Uma thread pode estar vinculada a contato, deal e canal.
4. O inbox deve suportar triagem, atribuicao e historico operacional.

## Regras de Atendimento IA x Humano

Estados atuais consolidados:

- `ai_active`
- `human_queue`
- `human_active`
- `resolved`
- `closed`

Regra:

1. Enquanto estiver em `human_active`, a IA nao deve responder.
2. Quando um lead pedir humano, a thread pode ir para `human_queue`.
3. Quando um operador assume, a thread vai para `human_active`.
4. Quando o atendimento termina como `resolved`, a conversa pode voltar para IA no proximo contato.
5. `closed` representa encerramento manual/administrativo.

## Regras do MVP Imediato de Atendimento

No MVP imediato de atendimento com IA:

1. A IA responde apenas mensagens de texto.
2. A IA atua apenas quando a thread estiver em `ai_active`.
3. Quando houver necessidade de continuidade humana, a thread vai para `human_queue`.
4. A IA deve registrar resumo claro do atendimento para continuidade.
5. A empresa usa o atendimento normalmente, mas sem acesso a configuracao avancada da IA.

## Regras de Reentrada

1. Se a thread estiver `resolved` e o lead voltar a falar depois, a IA pode voltar a atender.
2. `resolved` e diferente de `closed`.

## Regras de Multiatendente

1. Uma clinica pode ter mais de um atendente no mesmo numero.
2. O numero pertence a clinica, nao a um operador individual.
3. A thread pode ser atribuida a um responsavel.
4. O autor humano da mensagem deve poder aparecer no registro da conversa.
5. O modelo atual suporta handoff e atribuicao simples; evolucoes de disponibilidade/fila real ainda sao etapa posterior.

## Regras de Outbound

1. O outbound registrado no inbox deve tentar envio real pela Evolution quando houver conexao valida.
2. Se o envio externo falhar, a mensagem ainda pode permanecer registrada operacionalmente.
3. O sistema deve mostrar status de entrega ou falha na propria conversa.

## Regras de Produto para o Cliente

1. O cliente final nao deve ver conceitos internos como:
- edition
- seed
- snapshot
- template

2. A experiencia da clinica deve ser:
- CRM pronto
- funil configurado
- marca aplicada
- canais preparados

## Regras de Seguranca Operacional

1. Uma clinica nao deve ver dados de outra.
2. A agencia nao deve operar modulo de clinica sem contexto valido de tenant.
3. Falha em permissao granular nao pode derrubar o workspace inteiro.
4. Navegacao errada deve redirecionar ou falhar claramente, nunca ficar em spinner infinito.

## Regras de UX Ja Aprendidas

Aprendizados concretos do projeto:

1. Misturar troca de clinica com troca de board confunde a operacao.
2. Menu lateral precisa refletir clinica ativa.
3. O usuario precisa entrar na clinica por uma acao explicita e clara.
4. WhatsApp e Conversations nao podem ficar escondidos de forma que parecam "nao implementados".

## Pontos Abertos

Ainda dependem de decisao futura:

- posicao final de `WhatsApp` e `Conversations` no menu principal
- estrategia final de disponibilidade/fila real para multiatendente
- politica de dominio/subdominio para entrada da clinica
- regras mais finas de relatorios clinicos
