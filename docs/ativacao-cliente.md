# Ativação de cliente — o que precisa para ligar o CRM em qualquer clínica

> Parte da documentação-mãe. Índice em [README.md](./README.md).
> Responde: o que o CLIENTE fornece, o que a AGÊNCIA configura, e o que o
> PRODUTO ainda não tem — para o CRM rodar completo em qualquer operação, não
> só no piloto. Escrito em 2026-07-23 a pedido do Junior.

## A regra de ouro

O cliente fornece **operação** (número, pessoas, números do negócio, conteúdo).
A agência fornece **infraestrutura** (Evolution, chaves, provisionamento).
Se a ativação exigir do cliente qualquer coisa técnica além de escanear um QR,
está errado.

## 1. O que o CLIENTE fornece (checklist de onboarding)

| Item | Para quê | Exemplo no piloto (Adel/Jéssica) |
|---|---|---|
| **Número de WhatsApp dedicado** (chip ativo num celular) | canal de atendimento + follow-up; pareia por QR | ⏳ pendente — hoje roda em número TEMP da agência |
| (Opcional) **2º número** para separar humano × IA | multi-número já suportado (IA "Julia" num, secretária noutro) | decisão em aberto |
| **Lista de procedimentos/serviços + preços** | catálogo de produtos, etiquetas de serviço, valor dos negócios | veio do diagnóstico |
| **Profissionais** (nome, especialidade, % comissão) | relatórios financeiro/profissionais | Dra. Jéssica + quadro |
| **Taxas de cartão e custos fixos** | resultado líquido real | mapa da planilha (v17.6) |
| **Origens de lead que usa** (anúncio, indicação...) | catálogo de origens + painel comercial | Anúncio IG, Google, Indicação |
| **Cadência de follow-up** (mensagens, tempos) OU aceitar nosso template | o conteúdo do funil de automação | F1–F9 da Jéssica (PDF) + 12 vídeos |
| **Pessoas que vão usar** (nome, email, papel) | convites com permissão certa | Vitória (secretária), Adel |
| (Se tiver) **sistema de agenda** e credenciais | integração de agenda | Clinicorp (subscriber_id etc. — já conectado) |
| (Opcional) **aba de planilha onde colar o link de totais** | espelho de números no Sheets do cliente | planilha do Adel |

## 2. O que a AGÊNCIA configura (tudo já tem tela/rota no produto)

Em ordem de ativação:

1. **Criar o tenant** — Plataforma → Nova Clínica (provisioning wizard, edição
   `clinic`, branding, domínio se houver).
2. **Convidar os usuários** com cargo + permissões (E1/E2 — os toggles bloqueiam
   de verdade).
3. **Conectar o WhatsApp** — Conexões → nova conexão → QR no celular do número
   do cliente. Credencial Evolution: default da agência (já configurada).
   Webhook se configura sozinho no pareamento.
4. **Configurar a IA** — Configurações → IA: provider + chave (da agência ou do
   cliente, por org), features ligadas, prompt/persona ajustado ao cliente.
   ⚠️ Lembrar: IA de conversa tem chave PRÓPRIA (`aiEnabled` da conexão),
   separada da trava do funil.
5. **Montar os catálogos** — produtos/procedimentos, profissionais, comissões,
   taxas de cartão, custos fixos, origens de lead, categorias+etiquetas.
6. **Montar o funil** — boards (template ou personalizado) + automações no
   construtor com etiqueta de gatilho + mensagens da cadência.
7. **Ligar relatório externo** (opcional) — gerar report token e colar o link
   `=IMPORTDATA` na planilha do cliente (só totais agregados, sem PII).
8. **Testar em simulação** → aceite do cliente → **ligar envio real**
   (`set_automation_live_enabled` — só passa com scheduler saudável).

## 3. O que o PRODUTO ainda não tem (é isso que falta pra "finalizar o CRM")

Em ordem de dependência — cada item aponta onde já está planejado:

| # | Lacuna | Impede o quê | Onde está no plano |
|---|---|---|---|
| 1 | **C2D** — tarefas/mover etapa reais + observabilidade navegável | operar o funil no dia a dia e VER o que rodou/falhou | próxima fatia (SPEC-ENTREGA-C) |
| 2 | **C3 — mídia no funil** (bucket + worker ffmpeg + variantes) | cadências com vídeo/áudio (os 12 vídeos do piloto esperam isso) | SPEC-ENTREGA-C |
| 3 | **Envio real de ponta a ponta validado** (hoje 100% simulação) | qualquer cliente de verdade | gate já construído; falta o aceite |
| 4 | **Templates de cadência por vertical** (a F1–F9 empacotada como template instalável) | ativar cliente novo sem montar funil do zero | registry de templates já existe; falta o conteúdo |
| 5 | **Financeiro v2 (caixa)** — absorver o restante da planilha do Adel | aposentar a planilha de qualquer cliente | mapa célula-a-célula garimpado (`historia-e-origens.md`) |
| 6 | **Agenda genérica** — hoje só Clinicorp | cliente sem Clinicorp fica sem agenda | decidir: agenda nativa simples OU conectores por sistema |
| 7 | **O5 — ciclo de vida do tenant** (pausar/arquivar/excluir com segurança) | operar N clientes com churn | SPEC-ENTREGA-C |
| 8 | **Correções do pente fino** (bug `get_contact_stage_counts`, RLS origens no deploy, código morto) | confiabilidade | `PEDIDO-OPINIAO-PENTE-FINO.md` (com o Codex) |
| 9 | (Aceito, não urgente) personalização self-service (cores, ordem de menu) | escalar sem dev | backlog do Junior |
| 10 | (Aceito, DEPOIS de 1–7) **CRM próprio da agência** — leads de anúncio/prospecção e funções agência-only; hoje `/platform` é só administração | a agência se vender com o próprio produto | decisão do Junior 2026-07-23, em `decisoes.md` |

**Fora do produto (decisão consciente):** escrever DENTRO da planilha do cliente
(Sheets API/OAuth). A direção é o contrário — o Financeiro do CRM substitui a
planilha; o link de totais é a ponte durante a transição.

## 4. Critério de "CRM finalizado" (proposta)

> Um cliente novo, sem nada além do checklist da seção 1, sai operando em
> **1 dia de trabalho da agência**: WhatsApp pareado, funil com cadência
> instalada de template, financeiro configurado, equipe convidada com
> permissões certas, tudo testado em simulação e envio real ligado — sem
> nenhum passo manual fora das telas do produto.

Quando os itens 1–7 da seção 3 fecharem, esse critério vira teste de aceite
com um cliente-sombra (tenant de ensaio) antes de valer para cliente pagante.

## Pendências específicas do piloto (Jéssica) hoje

1. **Número de WhatsApp definitivo** — falar com o Adel (chip dedicado; decidir
   se 1 ou 2 números). Hoje roda em número TEMP da agência.
2. **Link de totais na planilha do Adel** — gerar report token e colar quando
   ele indicar a aba (não precisa de mais nada dele).
3. Clinicorp: **já conectado** (config no banco). Nada a pedir.
4. Cadência F1–F9: as versões .md vigentes são **texto-only** — a decisão
   registrada em `02-followup/README.md` é "sem vídeo nos follows" (os
   criativos já rodam em anúncio; reintroduzir só com mídia NOVA). Dos 12
   MP4: 11 tecnicamente válidos, 1 corrompido (`F3 - Video 2`), 3 com CTA de
   anúncio incompatível — servem como fixture técnica da C3, **não** como
   conteúdo aprovado (parecer Codex §6.2).
