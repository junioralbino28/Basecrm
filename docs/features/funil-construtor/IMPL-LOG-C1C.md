# IMPL-LOG — C1C (mover passos e dividir caminho)

Data: 2026-07-21  
Branch: `feat/funil-construtor`  
Escopo executado: R3 e R2 de `SPEC-ENTREGA-C.md`, adendo do
`PEDIDO-C1C.md` e as duas dívidas técnicas aprovadas.

## Resultado

A C1C foi concluída com o comportamento aprovado no mockup, sem transformar o
mapa em canvas livre:

- um passo pode ser movido ao pressionar o cartão, ultrapassar 10 px de
  deslocamento e soltar sobre uma linha elegível a até 150 px;
- a linha de destino fica destacada durante o gesto e soltar fora de uma linha
  elegível não altera o fluxo;
- clique com tremor de até 10 px continua abrindo a doca;
- raiz, bifurcação e a própria subárvore não são destinos inválidos;
- mover o último passo de qualquer caminho preserva esse caminho com uma
  folha-placeholder, inclusive quando o pai é um `switch`;
- a mesma operação está disponível pelo teclado na doca, com destinos descritos
  como `Entre X e Y`;
- o passo **Divide caminho** permite criar, nomear, editar, reordenar e remover
  casos, com avaliação `primeiro que combinar vence` e `Caso contrário` sempre
  no final;
- IDs dos casos permanecem estáveis e as arestas `case:<UUID>` são aceitas e
  persistidas pelo endpoint de rascunho;
- o limite de 20 casos mostra orientação em PT-BR;
- remover um caminho com subárvore é bloqueado com a mensagem:
  `Este caminho tem passos abaixo. Mova ou remova esses passos antes de apagar o caminho.`;
- o contrato `service-tag-entity-v3` foi preservado como fronteira para a C2;
  não foi criado seletor textual novo sobre `deals.tags`;
- o runner `npm run test:local` confirma o Supabase local antes de rodar e nunca
  ecoa `ANON_KEY` ou `SERVICE_ROLE_KEY`;
- o teste de isolamento de `clinic_staff` foi alinhado ao contrato real de RLS.

## Commits

| Tarefa | Commit | Descrição |
| --- | --- | --- |
| Runner local | `7c61afb` | `test(funil): proteger suíte completa no Supabase local` |
| Isolamento RLS | `8a97682` | `test(funil): alinhar isolamento do operador` |
| R3 — domínio | `1b7f066` | `feat(funil): recosturar passos sem perder caminhos` |
| R3 — interface | `5c13a6e` | `feat(funil): mover passos pela linha e pelo teclado` |
| R2 | `dfc0582` | `feat(funil): construir e editar divisões de caminho` |
| Invariantes | `0e0107b` | `test(funil): reforçar invariantes de caminhos na C1C` |
| Persistência | `e35f5b7` | `fix(funil): aceitar arestas case UUID no salvamento` |
| Teste F4 | `4e76f28` | `test(funil): isolar corrida do scheduler por job` |

## Evidências de TDD e verificação

- os testes do movimento cobrem recostura, bloqueio da raiz e de bifurcações,
  exclusão da subárvore, limite de 150 px e preservação de caminho com
  placeholder;
- há regressão explícita para `pointerup` com deslocamento exatamente igual a
  10 px abrir a doca;
- os testes do `switch` cobrem IDs estáveis, ordem, fallback final, teto de 20
  casos e bloqueio da remoção com subárvore;
- o schema HTTP tem teste para aceitar `case:<UUID>` e rejeitar um sufixo que
  não seja UUID;
- o teste concorrente do scheduler passou duas vezes seguidas isoladamente: 4
  de 4 testes em cada rodada;
- `npm run test:local`: 180 arquivos e 830 testes passando, 0 falhas;
- `npm run precheck:fast`: lint e TypeScript verdes; 705 testes passando, 125
  ignorados e 0 falhas.

## Aceite no navegador

O aceite foi executado no Chrome, em `http://localhost:3000`, com Playwright e
credencial/organização efêmeras criadas somente no Supabase local. A jornada
confirmou:

- criação de uma automação e de um passo **Divide caminho**;
- inclusão do segundo caso, edição dos valores `DDD 11` e `DDD 21` e
  reordenação dos casos;
- movimento pelo teclado de um passo de caminho para outra linha, preservando o
  caminho de origem com placeholder;
- gesto físico do mouse sobre outro passo: estado de ordenação ativo, linha de
  destino destacada e passo efetivamente recosturado;
- tremor físico de 6 px por 8 px — distância total de 10 px — abrindo a doca;
- salvamento, recarga e persistência do `switch`, dos dois casos, dos passos
  movidos e das folhas-placeholder.

O primeiro salvamento do aceite expôs um `PATCH 400`: o endpoint usava um enum
estático anterior à C1A e recusava `case:<UUID>`, embora compilador e banco já
aceitassem esse outcome. O schema passou a usar a validação canônica de arestas;
o teste de regressão foi escrito e o segundo salvamento retornou `PATCH 200`.

No console, apenas o coletor opcional de telemetria local em
`127.0.0.1:7242` estava indisponível. Não houve erro funcional. Ao fim, usuário,
organização, automação e dados do aceite foram removidos do Supabase local, e a
captura temporária foi apagada.

## Ajuste no teste concorrente do scheduler

O `npm run test:local` novo revelou uma interferência entre fixtures: o teste de
`FOR UPDATE SKIP LOCKED` chamava `claim_automation_jobs` sem `p_job_id`, podendo
consumir jobs de outros arquivos executados em paralelo antes de alcançar o job
alvo. As duas chamadas concorrentes agora filtram o mesmo UUID. A prova continua
sendo a mesma — somente um worker recebe aquele job — sem depender da fila
global do banco de teste.

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
4. Clique em **Nova automação**, dê um nome e clique em **Criar automação**.
5. Use o `+` depois de um passo, pesquise **dividir** e selecione
   **Divide caminho**. A doca do passo abrirá abaixo do mapa.
6. Na doca, escolha o campo e o operador, dê um nome ao caso e preencha o valor.
   Clique em **Adicionar caminho** para criar outros casos. Arraste os casos pela
   alça para mudar a prioridade: o primeiro que combinar vence; **Caso
   contrário** sempre fica por último.
7. Feche a doca e clique em **Ajustar** para enquadrar toda a árvore.
8. Para mover um passo com o mouse, pressione o cartão, mova mais de 10 px e
   aproxime-o da linha desejada. A linha fica verde-água. Solte para mover. Se
   soltar longe das linhas, nada muda.
9. Se o passo for o último de um caminho, o caminho continua visível com
   **Configurar este caminho**. Para apagar o caminho, primeiro mova ou remova os
   passos abaixo dele.
10. Alternativa sem arrastar: clique no passo, abra **Mover pelo teclado** na
    doca, escolha um destino `Entre X e Y` e clique em **Mover passo**.
11. Clique em **Salvar** e recarregue a página. O `switch`, a ordem dos casos e
    os passos movidos devem permanecer iguais.

O campo de etiqueta de serviço continua sendo apenas a fronteira visual
`service-tag-entity-v3`. O seletor por entidade UUID será implementado na C2,
sem consolidar texto livre nesta entrega.
