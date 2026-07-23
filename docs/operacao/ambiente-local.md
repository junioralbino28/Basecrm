# Ambiente local de desenvolvimento

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).

## Pré-requisitos

- **Docker Desktop ABERTO.** Sem ele o Supabase local cai e o `dev:local` recusa
  subir de propósito (trava de segurança). Sintoma clássico: tudo estava
  funcionando, fechou o Docker, nada sobe mais.
- Node + npm instalados (o projeto usa Next.js 16 com Turbopack).

## Subir o ambiente

```bash
npm run dev:local
```

**NUNCA use `npm run dev` para desenvolvimento.** O `.env.local` aponta para o
banco de PRODUÇÃO da clínica. O `dev:local` sobe contra o Supabase local
(127.0.0.1:54321) com dados de teste — e imprime qual banco está usando na
primeira linha.

Se o Supabase local não estiver de pé (containers `supabase_*_crmia` no
Docker), suba-o antes. Os containers reiniciam sozinhos quando o Docker
Desktop abre; espere o `supabase_db_crmia` ficar `healthy`.

## Contas de teste (org "Clinica Teste (local)")

| Login | Senha | Papel | Serve para |
|---|---|---|---|
| `junior@local.test` | `Funil2026!` | `clinic_admin` | criar tudo: catálogo, gatilhos, publicar |
| `secretaria@local.test` | `Funil2026!` | `clinic_staff` | testar o que a recepção pode (etiquetar sim, criar etiqueta não) |
| `vendedor@local.test` | `Funil2026!` | `vendedor` | mesmo nível da secretária nas etiquetas |

Se um `db reset` apagar as contas, recriá-las via API admin do GoTrue local com
`user_metadata` `{ name, role, organization_id }` — o trigger `on_auth_user_created`
cria o perfil sozinho a partir desses metadados.

## Dados de teste (seed)

O funil "Funil de Vendas" (6 etapas) com 5 leads/contatos foi semeado via SQL
idempotente. Se precisar recriar após um reset, o script está no histórico da
sessão de 2026-07-23 (checkpoint no cenoura-brain) — ele não duplica se o funil
já existir.

## Armadilhas conhecidas (todas já nos morderam)

1. **Matar o wrapper do npm NÃO mata o Next.** Antes de mexer em `.next`,
   confirme o PID real na porta 3000 (`Get-NetTCPConnection -LocalPort 3000`) e
   mate-o (`taskkill /PID <pid> /F`). Apagar `.next` com o servidor vivo
   corrompe as rotas (404/500 em telas que existem) — já aconteceu 2×.
2. **Aba do navegador aberta de antes de um restart do Docker** fica com o
   cliente Supabase travado: `Failed to fetch` em tudo, Realtime em loop.
   Correção: Ctrl+Shift+R (ou logout/login).
3. **Erro "API key não configurada para Google Gemini"** ao usar recursos de IA
   no local é esperado — não há chave de IA no ambiente local.
4. **Nunca rode migration/teste/query contra o banco da clínica**
   (projeto `eqidsihasmwwamkaqfka`). Local é 127.0.0.1 sempre.
