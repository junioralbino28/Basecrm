# E2 — Enforcement de permissões · SPEC

> **Status:** 🟡 aguardando aprovação do Junior.
> **Autor:** Claude. **Implementa:** Codex (a partir do `PLAN.md`, escrito depois desta aprovação).
> **Base técnica verificada:** `MAPA-CODIGO.md` (nesta pasta).

## O problema, em uma frase

Hoje os toggles de permissão do convite (E1) **gravam** o que cada pessoa pode fazer, mas **não bloqueiam nada** — se você desligar "Financeiro" pra Vitória, ela continua vendo a tela do Financeiro. O E2 faz os toggles valerem de verdade.

## Por que não é só "esconder o botão" (a parte de segurança)

Descobri no mapa do código uma coisa que muda o desenho: **esconder a tela no navegador não é segurança de verdade.** Quem entende de código consegue digitar o endereço direto e ver o conteúdo mesmo com o menu escondido — e hoje o CRM tem exatamente esse furo em Configurações (dá pra abrir `/configuracoes/financeiro` na mão e ver, mesmo sem a aba aparecer).

Então "desligar o Financeiro pra Vitória" tem que fazer **duas coisas ao mesmo tempo**:

1. **Esconder a tela** — ela não vê o menu nem consegue abrir a página (isso é experiência do usuário).
2. **Bloquear os dados no servidor** — mesmo que ela digite o endereço na marra, o servidor recusa e os dados não chegam (isso é a segurança real).

A camada 2 é a que importa pra você não ter vazamento de dado — que é o seu risco número um. O E2 entrega as duas.

## O que o E2 entrega

**Fundação (invisível, mas destrava tudo):**
- Fazer o app carregar, pra cada usuário logado, as permissões dele (hoje o app só sabe o "cargo base", não os toggles individuais).
- Criar uma peça reutilizável de "checar permissão" e uma tela padrão de "Acesso restrito" — hoje cada tela reimplementa isso na mão, do seu jeito.

**Bloqueio real nas áreas sensíveis** (as que expõem dado ou dão poder):
- **Financeiro** (relatórios financeiros e a aba financeiro das configurações)
- **Configurações** (produtos, profissionais, integrações, equipe, auditoria) — incluindo tapar o furo do acesso por URL direta
- **Equipe** (gerenciar usuários e convites)
- **Atendimentos** (que hoje está **totalmente aberto** — qualquer um vê e edita)

Em cada uma: o menu some pra quem não tem a permissão, a tela mostra "Acesso restrito" se tentar entrar, e o servidor recusa os dados.

## O que fica FORA por agora (proposta)

Pra este primeiro corte não virar um monstro, deixo pra um E2.2 depois: **Agenda, Contatos, Funis, Tarefas, Conversas**. Motivo: são menos sensíveis (não expõem financeiro nem dão poder administrativo) e o volume de telas é grande. Quando a fundação estiver pronta, aplicá-las vira repetição rápida. Se você quiser alguma delas já no primeiro corte, é só falar.

## Como vamos saber que está pronto (critério de sucesso)

**Com um usuário de teste "Equipe da Clínica" com o Financeiro desligado no convite:**

1. Ele **não vê** o menu Financeiro nem a aba financeiro das Configurações.
2. Se ele **digitar o endereço do Financeiro direto** no navegador, vê "Acesso restrito" — não o conteúdo.
3. Se tentar puxar os dados financeiros na marra (a chamada que a tela faz), o **servidor responde 403** e não devolve dado.
4. O mesmo vale, na mesma passada, pra Configurações, Equipe e Atendimentos.
5. Um usuário **Admin da Clínica** continua vendo e usando tudo normalmente.
6. Nada do que já funciona quebra (a suíte de testes continua verde).

Quando esses 6 pontos passarem — verificados por mim na revisão e por você no localhost — o E2 está pronto.

## Fatos técnicos que o Codex vai usar (verificados)

Do `MAPA-CODIGO.md`, pra o PLAN ser preciso:
- O modelo de permissão (`lib/auth/permissions.ts`) já tem `hasPermission`/`resolvePermissionMap` prontos — o E2 usa, não reinventa.
- O servidor já tem o gate granular certo (`requireTenantAccess({requiredPermissions})`) — hoje só usado no WhatsApp/Conversas. O E2 estende pras rotas sensíveis.
- O cliente **não** carrega as permissões do usuário (`useAuth` só tem o cargo) — a fundação resolve isso.
- **Atendimentos não tem rota de API** — os dados vão direto ao banco protegidos só por "mesma clínica" (RLS). Pra bloquear por permissão aqui pode ser preciso mexer na regra do banco (RLS) — o PLAN vai detalhar; é o ponto de mais atenção do E2.

## Decisão sua antes de eu escrever o PLAN

1. **Escopo do primeiro corte** — topa o corte acima (Financeiro + Configurações + Equipe + Atendimentos, e deixar Agenda/Contatos/Funis/Tarefas/Conversas pro E2.2)? Ou quer incluir/tirar alguma área?
2. O **critério de sucesso** (os 6 pontos) reflete o que você espera? Ajusta algo?

Com seu OK, escrevo o `PLAN.md` — o passo a passo técnico, com testes, que o Codex executa sozinho.
