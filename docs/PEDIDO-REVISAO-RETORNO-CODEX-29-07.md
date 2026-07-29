# PEDIDO DE REVISÃO — Retorno do Codex, 29/07/2026

> **Pra você (Codex), direto ao ponto:** você ficou fora de 24/07 a 28/07 (teto semanal).
> Nesse período o Claude continuou implementando (modelo invertido: **Claude implementa →
> Junior testa ao vivo → você revisa**), e TUDO que foi tocado está registrado como pacote
> fechado em `docs/FILA-REVISAO-CODEX.md`. Este arquivo é o seu briefing de retorno:
> o que estava fechado quando você saiu, o que aconteceu na sua ausência, e o que você
> precisa revisar e fazer — em ordem.

---

## 1. Estado atual (verificado em 29/07 de manhã)

- Branch: `feat/funil-construtor` @ **`2ea8434`** (último commit de CÓDIGO: `5624e5e`; o `2ea8434` é docs)
- Tree limpa, tudo pushado, deploy Vercel **READY**
- Baseline: **`test:local` 1011/1011 (213 arquivos)**, verde em `5624e5e`, lido ANTES do commit
- `main` **intocado** · CRM no ar na URL da branch · **banco = PRODUÇÃO da Dra. Jéssica** (piloto real, Adel testando agora em paralelo a você)
- Gates que continuam valendo: `automation_live_enabled=false` · envio de mensagem OFF · escrita no Clinicorp OFF (leitura em prod liberada pelo Junior) · sem deploy/push em `main`

## 2. O que estava FECHADO antes de você sair (até 24/07)

- Construtor de funil: C1A/C1B/C1C e C2A/C2B **revisados e aprovados por você**; C2C implementada e testada ao vivo (faltando só a sua revisão = Pacote 1)
- Hotfix de segurança das RPCs/rotas de canal: entregue por você, adjudicado e aprovado sem correção
- Seus 3 achados em aberto (registrados, ainda SEM correção — reconferir na revisão):
  1. **Grants largos do `anon` em `appointments`** (até TRUNCATE) — ficou **URGENTE**: a Agenda fatia 1 (Pacote 8) agora grava nessa tabela via cliente do usuário
  2. **Default inseguro em `isAIFeatureEnabled`** (`lib/ai/features/server.ts`): flag ausente/erro = IA LIGADA (candidato G24) — mitigado com flag explícita `false` na org da Jéssica, mas o default segue errado
  3. **Duas threads pro MESMO contato** em produção — investigar matching de thread por telefone (foco 5 do Pacote 7)

## 3. O que foi feito na sua ausência (24→28/07) — resumo por pacote

Detalhe completo, commits e focos adversariais: **`docs/FILA-REVISAO-CODEX.md`** (leia INTEIRO antes de começar).

| Pacote | O que é | Camada |
|---|---|---|
| **3** | Remuneração da equipe: 5 migrations, reescrita da RPC `get_commission_report`, comissão por vigência (nunca edita o passado), catálogos cargo/especialidade, várias especialidades por pessoa, unificação do cadastro | 🔴 **MOTOR** |
| **7** | WhatsApp AO VIVO: número da IA conectado na Evolution (produção), parser de erro corrigido, semáforo de conexão, notificações (badge por MENSAGENS + janela + som + permissão em 4 estados + auto marcar-lida), e **bug antigo de motor**: webhook esmagava `unreadCount` em `ai_active` | 🟡 UI + 🔴 **MOTOR** (webhook) |
| **6** | CSV de totais passa a contar leads de `contacts` (a `leads` está morta com 0 linhas); o teste N7 parou de inserir na tabela morta | 🟢 leitura |
| **1** | C2C completa: construtor + sincronia + nomenclatura neutra + ~10 correções testadas ao vivo | 🟢 UI |
| **2** | Reforma 2: canvas vertical + botão de trocar direção (preferência em localStorage) | 🟢 UI |
| **8** | Tarde de 28/07: bolinhas âmbar Hoje/Tarefas · "Registrar atendimento" no card do lead · reset simétrico de especialidade · **Agenda NOSSA fatia 1** (grade por dentista padrão Clinicorp, CRUD local em `appointments`, zero Clinicorp) | 🟢 UI + 🟡 serviço |

Fora do repo (contexto, não é código): produção semeada (101 produtos / 7 profissionais / 90 regras) · email transacional próprio `nao-responda@basea2.com` no Supabase (SMTP 587, templates PT) · **conserto de acentuação em prod (29/07)**: a pipeline de semeadura corrompeu 105 registros com mojibake ("JÃ©ssica"); reparado direto no banco com `convert_from(convert_to(col,'WIN1252'),'UTF8')`, 0 restantes — não estranhe timestamps de update nesses dados.

**3 defeitos do Claude no caminho, já corrigidos e documentados** (tratar como mapa de área escorregadia, não assunto encerrado): cabeçalho de segurança perdido ao reescrever a RPC (`c5e405f`) · coluna nova sem espelho do par legado (gatilho + coalesce) · GRANT esquecido nas tabelas novas (`40e455d`). Um 4º de processo: um commit subiu com suíte quebrada porque leitura e commit estavam encadeados — regra nova: **ler a suíte em comando separado ANTES de commitar**.

## 4. Sua missão, em ordem

**Ordem de revisão: 3 → 7 → 6 → 1 → 2 → 8.** Motor primeiro (3 e 7 travam fatia nova); 6 é minúsculo; UI por último.

Para cada pacote:
1. Ler o bloco dele na `FILA-REVISAO-CODEX.md` — os "focos adversariais" são o mínimo, não o teto.
2. Revisar com produção verificada quando aplicável (você tem leitura; escrita só o que o Junior aprovar).
3. Parecer em `docs/REVIEW-PACOTE-<N>.md` no padrão de sempre: achado → arquivo:linha → severidade → correção proposta. Vale também "aprovado sem correção" com a prova do que conferiu.
4. Atualizar o estado do pacote na FILA (`PENDENTE` → `EM REVISÃO` → `REVISADO` com link).
5. **Correção de achado: propor no parecer primeiro.** Só implementar depois do OK do Junior (exceção: teste quebrado óbvio do próprio pacote, aí corrige e registra).

**Além da revisão, é seu:**
- Reconferir os 3 achados seus da seção 2 (grants `anon`/`appointments` agora é o mais urgente) e propor as correções no parecer do pacote correspondente (8, 7 e 7).
- Conferir se `test/funilTickHealth.local.test.ts` ainda depende de banco limpo (pendência sua de antes da pausa, pode já ter sido absorvida).

## 5. Regras invioláveis nesta rodada

- **NUNCA** `supabase db reset` no local (mata o seed C2C do Junior) · dev server = `npm run dev:local`
- Suíte completa antes de declarar qualquer coisa verde; saída pra ARQUIVO; **leitura em comando separado do commit**
- Push só na branch `feat/funil-construtor`; `main` e deploy intocados
- Banco de produção é a clínica REAL: leitura à vontade, escrita só com aprovação explícita do Junior no chat
- Mensagem de erro pra usuário = linguagem de leigo (o padrão já usado nas telas)
- O Adel está testando o CRM AO VIVO agora — se algo quebrar em produção durante sua sessão, avise o Junior antes de mexer

## 6. O que NÃO é seu (não tocar)

- Spec das fatias 2/3/4 da Agenda (espelho Clinicorp ida/volta + permissão do dentista) — só DEPOIS dos seus pareceres dos Pacotes 3 e 8
- Os 2 desenhos pendentes (parcelamento da clínica · resumo da IA pro handoff) — são do Claude com o Junior
- Ligar a IA, conectar número das atendentes, envio de mensagem — decisões do Junior, pós-revisão
