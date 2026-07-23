# Deploy e produção — regras da casa

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).

## Regras inegociáveis

1. **Sem `git push` e sem deploy sem aval explícito do Junior.** A branch de
   trabalho acumula commits locais de propósito.
2. **Envio real de mensagem desligado até segunda ordem:**
   `automation_live_enabled = false` e `delivery_mode = 'simulation'` em
   qualquer ambiente. Ligar envio real é decisão de negócio, não técnica.
3. **Nada de teste/migration/query no banco de produção da clínica**
   (projeto Supabase `eqidsihasmwwamkaqfka`). Verificação de produção é
   leitura, e mesmo assim com parcimônia.
4. **Segurança primeiro** (regra do produto): dado de paciente é o risco nº 1.
   Funcionalidade clínica sensível (anamnese/prontuário) só entra com RLS
   multi-tenant provada por teste.

## Estado de produção (atualizar a cada deploy)

| Item | Valor |
|---|---|
| Branch de produção | `main` |
| Último deploy | commit `be7fe35` · 34 migrations |
| Branch de trabalho | `feat/funil-construtor` (todo o construtor de funil + etiquetas) |
| Hosting | Vercel (plano FREE — sem cron da Vercel; scheduler é pg_cron + pg_net no Supabase, dispatch por worker na VPS) |

## Dívidas que SÓ se resolvem no próximo deploy

- **RLS de `lead_sources`**: em produção, a policy antiga ainda deixa
  `clinic_staff`/`vendedor` mutar (inclusive excluir) origem de lead. A correção
  está na branch (C2A) e chega com o deploy da C2. Exposição prática baixa
  (nenhuma tela chama delete), mas é dívida conhecida — não deixar atravessar.

## Checklist de deploy (quando o Junior autorizar)

1. `npm run test:local` verde no baseline atual.
2. `npm run lint` + `npx tsc --noEmit` verdes.
3. Revisar migrations novas uma a uma (são aditivas? tocam dado existente?).
4. Push da branch → PR → aval do Junior → merge.
5. Migrations aplicadas no projeto de produção ANTES do deploy do app.
6. Smoke test em produção com conta real (leitura, sem mexer em dado de paciente).
7. Confirmar `automation_live_enabled = false` depois da migração.
