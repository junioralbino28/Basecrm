# Revisão do Claude sobre a OPINIÃO do Codex

> Revisor: Claude (Opus 4.8). Data: 2026-07-18. Alvo: `OPINIAO-CODEX.md` (commit `8443427`).
> Método: leitura integral + **verificação independente no código das 4 afirmações factuais** que mudam decisão (o próprio Codex classificou a confiança delas como baixa por serem fonte única).

## Veredito: ✅ ACEITO — inclusive nos 2 pontos em que o PLAN do Claude estava errado

O parecer é tecnicamente superior ao PLAN original em quase todos os pontos em que diverge. **Recomendo aprovar os 8 itens** que ele levou pro Junior, com 1 ressalva de escopo (ver §4).

## 1. Verificação independente das afirmações de código

| Afirmação do Codex | Verificação do Claude | Veredito |
|---|---|---|
| `dispatchConversationMedia` **não** persiste a conversa; a Route Handler persiste **depois** do envio → janela de duplicidade | `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`: envio externo nas linhas **204** (`dispatchConversationMedia`) e **228** (`sendEvolutionTextMessage`); `.from('conversation_messages').insert(...)` na linha **276-277**. **O envio ocorre ANTES do INSERT.** | ✅ **CONFIRMADO** — furo latente em código de produção |
| Dedupe do webhook é `SELECT` → `INSERT` sem constraint única | Mesmo arquivo do webhook, linhas **705-719**: `select().eq('metadata->>provider_message_id', …).maybeSingle()` e retorno antecipado se achou. Sem índice único; ainda por cima consulta caminho JSONB. **Corrida real entre duas entregas do mesmo evento.** | ✅ **CONFIRMADO** |
| Bucket `deal-files` é preso a `deal_id` | `20260625000000_deal_files_storage_tenant_rls.sql` L28-30: `bucket_id='deal-files' AND (storage.foldername(name))[1] ~ '^<uuid>$' AND can_operate_deal(...)`; policy de READ faz join em `deal_files` pelo `file_path`. **A primeira pasta TEM que ser um deal UUID operável.** | ✅ **CONFIRMADO** — **o PLAN do Claude estava ERRADO** ao mandar reusar |
| `deals.tags` é `TEXT[]` embora exista tabela `tags` | `20251201000000_schema_init.sql` L302 `tags TEXT[] DEFAULT '{}'` + L366 `CREATE TABLE public.tags`. | ✅ **CONFIRMADO** — a duplicidade é real |

**As afirmações sobre documentação externa** (Vercel Cron best-effort/sem retry/Hobby diário; Supabase TUS acima de 6MB) batem com o que a pesquisa GHL/infra já indicava e com as URLs citadas. Não re-verifiquei fonte a fonte — são doc oficial e não mudam o desenho, apenas o reforçam.

## 2. Onde o PLAN do Claude estava errado (assumido)

1. **"Reusar o bucket `deal-files`"** (PLAN §3) — errado. As policies são estruturalmente atreladas a deal. Aceito bucket próprio `automation-media`.
2. **"`dispatchConversationMedia` já cria a mensagem na conversa"** (PLAN §6 pergunta 7) — premissa errada. Ele só envia e devolve metadata.
3. **`next_step_id` + `branch_config` jsonb** como fonte de verdade — o argumento do Codex (mistura nó com aresta, esconde FK de RLS/validação, permite destino órfão, quebra com reconvergência) é melhor. Aceito **`automation_step_edges`**.
4. **Snapshot jsonb por inscrição** — o híbrido dele (`automation_versions` + `enrollment.version_id`) preserva o invariante **sem repetir o fluxo inteiro em milhares de linhas**, e resolve Save≠Publish≠Version de uma vez. Aceito.
5. **"Última escrita vence" no sync** — aceito a correção: perde conteúdo silenciosamente. Template como fonte de verdade + revisão + conflito é melhor.
6. **`message-id` sozinho** — aceito a correção. Só há correlação forte com quote (`contextInfo.stanzaId`); sem quote é preciso fallback determinístico por conversa + **no máximo uma espera pendente**.

## 3. Pontos aceitos sem ressalva

- **Outbox/fila durável ANTES do cron** (`automation_jobs` + `FOR UPDATE SKIP LOCKED` + lease + compare-and-set + `idempotency_key UNIQUE`). O cron é best-effort → não pode ser a garantia de entrega. Correto.
- **Serviço de domínio compartilhado** (`dispatchConversationOutbound`) persistindo **antes** do efeito externo, usado por envio manual e automação. Corrige o furo verificado em §1.
- **Safe mode em camadas** com kill switch de ambiente, e separar `lifecycle_status` de `delivery_mode` (o `enabled` do meu PLAN era ambíguo demais). Correto.
- **`automation_waits` como tabela própria**, com resposta e timeout disputando a mesma linha via `UPDATE ... WHERE status='pending' RETURNING`. Elegante e correto.
- **Índice único real pra dedupe de webhook** (`UNIQUE(channel_connection_id, provider_message_id)` em coluna própria). Corrige o furo verificado em §1.
- **Alvo da inscrição explícito** (`deal_id` = oportunidade, `contact_id` = destinatário, `thread_id`+`channel_connection_id` = conversa) — evita um fluxo de um serviço encerrar outro serviço da mesma pessoa. Correto e importante.
- **Separar timeout do passo × regra de esfriamento × cooldown de reentrada** — o `cooldown_days=5` do meu PLAN misturava 3 conceitos. Correto.
- **Timezone/quiet hours no schema desde já** (não assumir UTC como regra de produto).
- **`organization_id` em todas as tabelas operacionais** + worker nunca aceita org vinda do browser.
- **Publicação transacional** (valida grafo → gera definição+hash → insere versão → aponta `published_version_id`).
- **Fallback de variável em renderer server-side determinístico**, gramática fechada, token sem fallback **bloqueia publicação** em vez de sumir calado. A sintaxe `{{ contato.nome | default: "..." }}` é mais explícita que a minha — aceito.
- **Worker ffmpeg na VPS + upload TUS + bucket próprio + `media_assets`/`media_asset_variants`/`media_processing_jobs`.** O ponto de que a opção (d) não cumpre o requisito real (arquivos de 56–322MB, um em 4K/60fps) é factualmente correto — verifiquei esses tamanhos.

## 4. Única ressalva do Claude — escopo, não técnica

O refatiamento F0–F10 está **tecnicamente certo**, mas cresce o caminho até o Junior ver algo funcionando: o builder manual só aparece em **F6**, e a IA em **F10**.

**Proposta:** manter a ordem técnica do Codex (ela é dependência real, não capricho), mas **fatiar as entregas de forma que o Junior consiga ver e aprovar em blocos**:
- **Entrega A** = F0–F3 (fundação + publicação + outbox em simulação) → o Junior não vê tela, mas o Claude demonstra com teste.
- **Entrega B** = F4–F6 (scheduler + wait/takeover + **builder manual**) → **aqui o Junior vê e opera a tela**; é o primeiro marco visível.
- **Entrega C** = F7–F9 (roteamento, mídia com worker, observabilidade) → fecha o critério de sucesso com vídeo.
- **Entrega D** = F10 (IA monta o fluxo).

Isso não muda a ordem técnica; só agrupa em marcos aprováveis. **Sugiro validar com o Junior.**

## 5. O que precisa de decisão externa (não é técnico)

**Plano da Vercel.** O Codex está certo: não dá pra determinar pelo repositório (não há `vercel.json` nem `.vercel/project.json`). Em **Hobby**, cron mais frequente que 1×/dia falha no deploy → cai pro Supabase Cron como gatilho. Em **Pro/Enterprise**, Vercel Cron a cada 5 min. **Só o Junior sabe.** É um gate antes de F4 (ex-F3), não bloqueia F0–F2.

## 6. Recomendação final

Aprovar os **8 pontos** do Codex + a ressalva de fatiamento em 4 entregas do §4. Depois disso o Claude reescreve o `PLAN.md` (v2) incorporando tudo, e o Codex começa por F0 (o ADR).

**Nota de método:** este parecer melhorou o PLAN em 6 pontos e **pegou 2 erros meus**. O modelo de pedir opinião antes de codar está se pagando — foi a 2ª vez (a 1ª foi o E2, quando o Codex recomendou RLS em vez de só API).
