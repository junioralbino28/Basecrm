# FILA DE REVISÃO PENDENTE (Codex)

> **Por que este arquivo existe.** O Codex bateu o teto semanal e volta **quinta 29/07/2026**.
> Enquanto ele está fora, o Claude continua avançando **só no que é barato de refazer**
> (UI, correções ao vivo, observabilidade de leitura, specs) — nunca fundação nova sobre
> código não-revisado. Cada frente tocada na ausência dele entra aqui como um **pacote fechado**,
> pra que a revisão dele seja **profunda e por partes** (não uma passada rasa gigante) e
> **nada escape**.
>
> **Regra de ouro:** se um pacote encosta em MOTOR (migrations, RPC, jobs, envio), ele é
> marcado 🔴 e **não** vira fundação de outra fatia até o Codex revisar. UI pura é 🟢.
>
> Fluxo por pacote: `PENDENTE` → (Codex revisa dia 29) → `EM REVISÃO` → `REVISADO` (link do parecer).
> Padrão de parecer segue o que já usamos: `PEDIDO-*.md` → `REVIEW-*.md` / `OPINIAO-*.md`.

Última atualização: 2026-07-24 · branch `feat/funil-construtor`

---

## Índice de pacotes

| # | Pacote | Camada | Estado | Parecer |
|---|--------|--------|--------|---------|
| 1 | C2C — Construtor + sincronia + nomenclatura + correções ao vivo | 🟢 UI (+🟡 ponte de dado) | **PENDENTE** | `PEDIDO-REVISAO-C2C.md` (a redigir) |
| 2 | Reforma 2 do construtor (canvas vertical + autosave + preview) | 🟢 UI | _não iniciado_ | — |
| 3 | C2D — observabilidade de LEITURA (telas "como eu confiro?") | 🟢 UI leitura | _não iniciado_ | — |
| 4 | C2D — motor (create_task / mover etapa real) | 🔴 MOTOR — **spec only** até o Codex | _não iniciado_ | spec a redigir |

---

## Pacote 1 — C2C: Construtor + sincronia + nomenclatura + correções ao vivo

**Estado:** PENDENTE (aguardando 29/07)
**Modelo:** UI implementada pelo Claude → testada ao vivo pelo Junior (C2C fechada de ponta a ponta) → **falta a revisão adversarial do Codex**.

**Commits (10 de código + 5 de docs), de `2b82356` a `96c2f83`:**

Código a revisar:
- `2b82356` — feedback de ganho + ponte origem (dívida 7c) + `formatBRL` em toda UI + nomenclatura neutra (paciente→lead/contato, "Insights IA")
- `197d0aa` — StaleChunkGuard (auto-reload de aba com chunks obsoletos)
- `bddf3b4` — cleanup das fixtures cobre contatos por NOME (runId) + tabela tasks (fim dos leads-boneco)
- `cf9ea64` — excluir passo no construtor (regras seguras + 6 testes) + confirmação de Publicar + dica Publicar→Testar
- `9996616` — tradutor de erros do motor pra linguagem leiga (`toFriendlyAutomationError`)
- `81044e6` — piso do zoom do mapa 70%→30%
- `a3634c3` — Dividir caminho intuitivo (valor vira lista funil/etapa por nome, dicas por campo)
- `ee3b37c` — construtor ocupa a tela real (flex h-full no lugar de calc chutado)
- `c36322a` — Reforma 1: edição em painel LATERAL direito (fim do dock inferior) + re-enquadrar
- `35ed75a` — menu "agendar rápido" do kanban em portal fixo (coluna não corta mais)

Docs de contexto: `1c56f9d`, `0b89e1d`, `062a7a0`, `eb92725`, `96c2f83`.

**Foco pedido ao Codex:**
1. **Construtor** — a montagem/edição/exclusão de passos, o Dividir caminho (switch), publicação imutável e o disparo do teste em simulação. É onde mais mexemos ao vivo.
2. **Ponte de dado 7c** (`recordAttribution` espelhando nome em `contacts.source`) — é dupla-verdade; validar que não abre inconsistência.
3. **Nomenclatura neutra** — varredura em ~27 telas; conferir que nada quebrou de rótulo/label em teste.
4. Regressões silenciosas nos módulos sem teste (tabela de dívida 9).

**Gates que continuam valendo (não reabrir):** `automation_live_enabled=false`, tudo `simulation`, sem push/deploy, produção intacta.

**Prova atual:** `test:local` = 941/941 · lint `--max-warnings 0` · tsc strict.

---

## Como adicionar um pacote novo (template)

Ao fechar uma frente nova esta semana, copiar este bloco pro final e somar linha no índice:

```
## Pacote N — <título>
**Estado:** PENDENTE
**Camada:** 🟢 UI / 🟡 ponte de dado / 🔴 motor
**Commits:** <sha..sha, lista>
**Arquivos-chave:** <paths>
**O que testar (leigo):** <em 1-2 frases o que o Junior conferiu ao vivo>
**O que pedir ao Codex:** <foco adversarial — onde pode ter gap>
**Encosta em motor?** <não / sim — se sim, NÃO virou fundação de outra fatia>
**Prova:** test:local N/N
```
