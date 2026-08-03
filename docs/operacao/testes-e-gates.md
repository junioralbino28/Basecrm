# Testes e gates de qualidade

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).

## Os gates, do mais fraco ao mais forte

| Comando | O que cobre | Quando usar |
|---|---|---|
| `npx vitest run` | Suíte unit completa (happy-dom, mocks) | Depois de qualquer mudança de código |
| `npm run lint` | ESLint com `--max-warnings 0` | Sempre antes de commit |
| `npx tsc --noEmit` | Typecheck estrito | Sempre antes de commit |
| `npm run test:local` | **Unit + integração real contra o Supabase local** | Antes de aprovar qualquer fatia; é O gate |

## A pegadinha que já nos enganou

`precheck:fast` e a suíte unit **pulam ~141 testes de integração em silêncio**
quando as variáveis `E2_SUPABASE_*` não estão presentes. Um "0 falhas" sem o
`test:local` **não significa nada** sobre o motor de automação, RLS ou RPCs.

O `scripts/test-local.mjs` existe exatamente para isso: injeta o ambiente do
Supabase local, **recusa alvo que não seja 127.0.0.1** e não ecoa chave.

## Baseline

Registrar aqui a cada fatia aprovada:

| Data | Fatia | `test:local` |
|---|---|---|
| 2026-07-21 | C1C | 830/830 |
| 2026-07-22 | C2A | 848/848 |
| 2026-07-22 | C2B | 869/869 |
| 2026-07-23 | C2C | 888/888 |
| 2026-08-03 | Correções do Pacote 3 (`553303a`) | **1103/1103 em 231 arquivos** |

No fechamento do Pacote 3 também passaram: `supabase db lint --local`,
TypeScript, ESLint e `next build`. O detalhe, incluindo testes focais e limites
da auditoria de segurança, está em
[`IMPL-LOG-CORRECOES-PACOTE-3.md`](../IMPL-LOG-CORRECOES-PACOTE-3.md).

## Baseline de segurança do fechamento de 03/08

- `npm audit`: 0 vulnerabilidades.
- Semgrep: 0 achados em 929 caminhos, com 2 arquivos parcialmente parseados.
- Gitleaks em 716 commits: 0 vazamentos.
- O runner canônico completo atingiu timeout durante `gitleaks dir` e não criou
  `status.json` final. Pelo critério fail-closed, o baseline geral é
  **inconclusivo**, não PASS.

Esses scanners cobrem somente parte dos gates de segurança. Nunca substituir
teste A↔B de RLS, invariantes financeiras e revisão das RPCs por uma contagem
zero de scanner.

Se o número CAIR em relação ao baseline sem explicação, algo quebrou.

## Ruído conhecido (não bloqueia)

- `DELETE .../deal_notes ... 400` no teardown de integração — aparece desde a
  C1C, os testes passam; é limpeza de fixture, não produto.
- `ECONNREFUSED localhost:3000` quando a suíte roda sem dev server — os testes
  que exercitam essa ausência passam; não confundir stderr com falha do gate.
- O build conclui, mas avisa rastreamento NFT amplo em `next.config.ts` →
  `lib/installer/edgeFunctions.ts` → rota `installer/supabase/resolve`.
