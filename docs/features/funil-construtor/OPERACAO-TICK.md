# Operação do tick e do executor de automações (2d)

**Data:** 2026-09-13
**Vale para:** cada ambiente separadamente (local → teste `teste.crm.basea2.com` → produção
`crm.basea2.com`). **Produção só com o preflight de 7 passos; nada aqui é executado em produção
sem o OK do Junior.**

## 1. O que precisa estar de pé para uma automação mandar mensagem

```text
pg_cron ("automation-tick-every-5-minutes", a cada 5 min)
  └─ request_automation_tick()            ← lê o cofre do Supabase (vault)
       ├─ vault: automation_tick_url      = https://<host>/api/internal/automations/tick
       └─ vault: automation_tick_secret   = <segredo>
       └─ pg_net POST <url>  Authorization: Bearer <segredo>
            └─ /api/internal/automations/tick   ← confere AUTOMATION_TICK_SECRET (Vercel)
                 ├─ roteia conversas esfriadas, expira esperas, materializa jobs
                 ├─ executor (2a): só se AUTOMATION_LIVE_SENDS_ENABLED=true no ambiente
                 │    ├─ adia envios em silêncio noturno / live desligado (2c)
                 │    ├─ reserva até 10 jobs, orçamento de 35 s
                 │    └─ mensagem real só se: versão publicada em "live"
                 │         + organization_settings.automation_live_enabled = true (2b)
                 │         + contato sem opt-out (2c)
                 └─ despacha marcos de conversão à Meta (3c)
```

**Achado de 13/09:** em produção o cofre nunca foi semeado (`automation_tick_url` /
`automation_tick_secret` ausentes). Por isso a saúde do tick fica `request_failed`, a chave de
live de qualquer cliente é recusada pelo gate (`55000`), e nada é enviado nem à Evolution nem à
Meta. Este documento é o procedimento para fechar isso.

## 2. Segredos e variáveis

| Onde | Nome | Para quê |
|---|---|---|
| Vercel (env do projeto) | `AUTOMATION_TICK_SECRET` | o tick só aceita `Bearer` igual a este valor |
| Vercel | `AUTOMATION_WORKER_SECRET` | rotas `jobs/claim`, `jobs/:id/complete`, `automations/execute` (cron externo / worker da VPS) |
| Vercel | `AUTOMATION_LIVE_SENDS_ENABLED` | `true` liga o executor no ambiente; qualquer outro valor = jobs esperam |
| Supabase → cofre (vault) | `automation_tick_secret` | **mesmo valor** de `AUTOMATION_TICK_SECRET` |
| Supabase → cofre (vault) | `automation_tick_url` | `https://<host do ambiente>/api/internal/automations/tick` |

Gere cada segredo com 32 bytes aleatórios (`openssl rand -hex 32`). Um segredo por ambiente;
nunca o mesmo em teste e produção. Guarde em `WorkSync/.secrets` (fora do repositório).

## 3. Procedimento por ambiente

1. **Vercel:** defina `AUTOMATION_TICK_SECRET`, `AUTOMATION_WORKER_SECRET` e
   `AUTOMATION_LIVE_SENDS_ENABLED=false` (por enquanto). Faça o redeploy do ambiente.
2. **Supabase (SQL Editor do projeto certo, conferindo o ref antes):**

   ```sql
   -- só se ainda não existir (conferir antes):
   select name from vault.secrets where name in ('automation_tick_url', 'automation_tick_secret');

   select vault.create_secret('https://<host>/api/internal/automations/tick', 'automation_tick_url');
   select vault.create_secret('<mesmo valor de AUTOMATION_TICK_SECRET>', 'automation_tick_secret');
   ```

   Para trocar um valor existente use `vault.update_secret(id, novo_valor)` com o `id` de
   `vault.secrets`.
3. **Confira o agendamento e force um tick:**

   ```sql
   select jobname, schedule, active from cron.job where jobname = 'automation-tick-every-5-minutes';
   select public.request_automation_tick();          -- dispara agora
   select stage, healthy, degraded, reason, last_http_status, last_error, consecutive_failures
   from public.automation_scheduler_health();        -- esperado: tick_succeeded, healthy = true
   ```

   Se `last_error` disser "segredo ou URL", o cofre está incompleto; se `last_http_status = 401`,
   o valor do cofre difere do da Vercel; `404/5xx` = URL errada ou deploy sem a rota.
4. **Ligue o executor:** `AUTOMATION_LIVE_SENDS_ENABLED=true` na Vercel + redeploy. A partir daqui
   jobs de **simulação** rodam sozinhos no tick (sem efeito fora) e os marcos da Meta saem.
5. **Por cliente, quando o Junior mandar:** `POST /api/settings/automations-live` com
   `{ "enabled": true }` (admin do tenant, na tela ou por chamada). O gate recusa com 409 se o
   tick não estiver saudável. Publicar a automação em modo **live** é o terceiro cadeado.

## 4. Desligar rápido (kill switch), do mais largo ao mais fino

| Alcance | Como | Efeito |
|---|---|---|
| Todo o ambiente | `AUTOMATION_LIVE_SENDS_ENABLED=false` + redeploy | nenhum job é reservado; tudo espera |
| Um cliente | `POST /api/settings/automations-live` `{ "enabled": false }` | envios "live" desse cliente são adiados de hora em hora; simulação continua |
| Uma automação | despublicar no construtor | novas inscrições param; as ativas seguem até o fim |
| Uma conversa | a IA reconhece que o lead não quer mais (1a) ou a recepção pausa | inscrições da conversa pausadas |

## 5. O que olhar no dia a dia

- `automation_scheduler_health()` — `healthy` e `consecutive_failures`.
- Resposta do tick (log da Vercel): `executed.sent / failed / unknown / errors` e `conversions`.
- `automation_enrollments` com `status = 'paused'` e `pause_reason` em
  (`delivery_failed`, `delivery_unknown`, `opt_out:*`, `inscricao_*`, `passo_sem_executor`): são
  os casos que pedem um humano. Ainda não há tela nem retomada; ver SPEC-ENTREGA-LIVE.md.
- `automation_jobs` em `unknown` ou `dead_letter` com `last_error`.
