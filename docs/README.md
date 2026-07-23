# Documentação do Basecrm — índice-mãe

> Qualquer pessoa (dev, IA, Codex) que for mexer neste sistema começa AQUI.
> Regra: mudou algo relevante, atualiza o doc correspondente NA MESMA entrega.

## Comece por estes, nesta ordem

1. **[STATUS.md](./STATUS.md)** — o que está pronto, o que está quebrado, o que
   falta. A matriz viva do sistema.
2. **[arquitetura/visao-geral.md](./arquitetura/visao-geral.md)** — o produto, a
   stack, o modelo multi-tenant e o motor de automação em 1 página.
3. **[operacao/ambiente-local.md](./operacao/ambiente-local.md)** — como subir
   sem quebrar nada (e as armadilhas que já nos morderam).

## Arquitetura (como funciona)

| Doc | Responde |
|---|---|
| [visao-geral.md](./arquitetura/visao-geral.md) | o mapa de tudo em 1 página |
| [rotas-e-navegacao.md](./arquitetura/rotas-e-navegacao.md) | toda URL, toda tela, sidebar, guards, aliases e duplicatas |
| [camada-de-dados.md](./arquitetura/camada-de-dados.md) | serviços, hooks TanStack, contextos, permissões no cliente |
| [banco-de-dados.md](./arquitetura/banco-de-dados.md) | as 55 migrations, todas as tabelas, RPCs, triggers, RLS, cron, storage |
| [apis-e-integracoes.md](./arquitetura/apis-e-integracoes.md) | 103 rotas de API, WhatsApp/Evolution, IA, Clinicorp, env vars, scripts npm |

## Produto (o que existe)

| Doc | Responde |
|---|---|
| [modulos.md](./modulos.md) | cada módulo de features/: propósito, arquivos, dados, testes, pendências |
| [decisoes.md](./decisoes.md) | decisões travadas (produto, arquitetura, processo) — não reabrir |
| [historia-e-origens.md](./historia-e-origens.md) | linhagem NossoCRM→Base CRM + mapa de TODA a documentação fora do repo (workspaces, ledgers, auditoria Codex, planilha do Adel) |
| [ativacao-cliente.md](./ativacao-cliente.md) | o que o cliente fornece × o que a agência configura × o que falta no produto — o caminho até "CRM finalizado" |
| [OPINIAO-CODEX-PENTE-FINO.md](./OPINIAO-CODEX-PENTE-FINO.md) + [REVIEW](./REVIEW-OPINIAO-PENTE-FINO.md) | auditoria independente do pente fino (P1: RPCs legadas; P2: DTOs de canal, origem dupla, call-list) + adjudicação com ordem de execução |
| [features/funil-construtor/](./features/funil-construtor/) | ciclo completo do construtor: SPEC, pedidos, adjudicações e revisões de cada fatia |

## Operação (como trabalhar)

| Doc | Responde |
|---|---|
| [operacao/ambiente-local.md](./operacao/ambiente-local.md) | Docker, `dev:local`, contas de teste, seed, armadilhas |
| [operacao/testes-e-gates.md](./operacao/testes-e-gates.md) | gates, a pegadinha do precheck, baseline 888/888 |
| [operacao/deploy-e-producao.md](./operacao/deploy-e-producao.md) | regras inegociáveis, estado de produção, checklist de deploy |

## Convenções desta documentação

- **PT-BR**, direto, sem jargão sem explicação.
- Todo doc de módulo segue o MESMO esqueleto: Propósito · Arquivos-chave ·
  Dados · Testes · Pendências.
- Afirmação sem verificação no código = marcada como "não verificado". Nunca
  se supõe.
- `STATUS.md` e `decisoes.md` são os únicos que TODO ciclo de entrega toca;
  os demais se atualizam quando a área muda.
- O histórico de COMO cada decisão foi tomada vive nos docs de ciclo
  (`features/funil-construtor/`); os docs-mãe registram só o estado atual.
