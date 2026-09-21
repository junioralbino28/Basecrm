# Tema CENNO HUB para o CRM

Especificação de tokens. Traduz a identidade da LP no ar (`WorkSync/workspaces/CENNO HUB/site-claude/styles.css`) para o tema padrão do CRM (Next.js 16 + Tailwind v4, `app/globals.css`), substituindo o tema teal/gold da clínica como default.

Autor: Howl (direção). Executor do handoff: Senku (implementação).
Data: 2026-09-18. Base medida: `app/globals.css`, `app/layout.tsx`, `tailwind.config.js`, `app/manifest.ts`, LP `styles.css` + `ch.svg`, brief `MARCA-BRIEF.md`, decisão `2026-09-06-rebranding-cenno-hub.md`.

---

## 0. Conclusão primeiro

**Decisões travadas**

1. `brand-50..900` vira laranja de matiz 48 (OKLCH) com **`#F87000` exatamente em `brand-600`**, o degrau que os botões primários já usam (86 ocorrências de `bg-brand-600`). `brand-500` = `#FF8417`, que é o hover literal do botão da LP, então o padrão dominante do app (`hover:bg-brand-500`, 57 ocorrências, contra 27 de `hover:bg-brand-700`) reproduz o comportamento da LP sem tocar em classe nenhuma: hover clareia, como no `.botao:hover { background: #FF8417 }`.
2. `brand-700` = `#CC5C00` e `brand-800` = `#AD4E00` são os dois oranges de texto que a própria LP já calibrou (`--orange-txt` e `--orange-mid`). A rampa incorpora os três oranges canônicos da marca em vez de inventá-los.
3. `gold-*` mantém o **nome** do token e passa a ser o **verde do CH** (`#008810` em `gold-600`). Nenhum dos 17 arquivos com `gold-*` precisa ser editado.
4. Semânticos saem de papel `#F2EDE3` / tinta `#14170E` no light e de `#14170E` / `#1D2116` no dark. `dark-bg/card/border/hover` passam a ser os mesmos valores dos semânticos, eliminando as duas fontes de verdade de hoje.
5. Tipografia: Montserrat em `--font-sans` **e** em `--font-display`; Instrument Serif itálico em `--font-serif`, restrito ao papel de "voz humana". Não repontar `--font-display` para a serifa.

**Os três achados que custam trabalho** (nenhum é opcional)

| # | Achado | Medição | Custo |
|---|---|---|---|
| A | **Texto branco não cabe em cima do laranja da marca.** `#FFFFFF` sobre `#F87000` dá **2,87:1** e reprova AA em qualquer tamanho. A LP resolve isso desde sempre: `.botao { background: var(--orange); color: var(--ink) }`. Tinta `#14170E` sobre `#F87000` dá **6,31:1**. | branco/600 = 2,87 · tinta/600 = 6,31 · branco/500 = 2,45 · tinta/500 = 7,39 | 76 ocorrências de `bg-brand-600 … text-white` + 48 de `bg-brand-500 … text-white` viram `text-ink` |
| B | **`text-brand-600` reprova no modo claro.** `#F87000` sobre papel dá 2,46:1 e sobre card branco 2,87:1. Não passa nem como texto grande. | 2,46 / 2,87 | 110 ocorrências de `text-brand-600` precisam de `dark:` split: `text-brand-800 dark:text-brand-400` |
| C | **Anel de foco com alpha não passa em modo nenhum.** `ring-brand-500/40` compõe para `#E3B388` sobre papel = **1,63:1**, contra os 3:1 que a SC 1.4.11 exige. O valor sólido que passa nos dois modos é `brand-700`. | 700 sólido: 3,53 (papel) · 4,12 (card) · 3,98 (dark-card) · 4,40 (dark-canvas) | 93 `ring-brand-500` + 41 `ring-brand-500/40` + 17 `ring-brand-500/50` viram anel sólido |

Nada disso é regressão introduzida pela troca de tema: o teal atual tem o mesmo tipo de problema em outros degraus. A troca é a hora certa de fechar.

**Bloqueio a resolver antes de aplicar:** hoje `--color-surface` e `--color-muted` estão definidos **duas vezes** em `app/globals.css`, primeiro no `@theme inline` (como `rgb(var(--surface))` / `rgb(var(--muted))`) e depois num segundo `:root` (como `oklch(99% 0.002 90)` / `oklch(95% 0.008 90)`). Mesma especificidade, o último do arquivo ganha. Se a cascata estiver de fato assim no CSS compilado, `bg-surface` (147 usos) e `text-muted` (113 usos) não estão lendo as triplas RGB do tema e vão continuar sem ler depois da troca. Conferir no CSS gerado antes de mexer nos valores (ver seção 10).

---

## 1. Escala `brand-50..900`: laranja da marca

Matiz OKLCH 48 (a de `#F87000`: `oklch(69.87% 0.1902 48.02)`). Degraus âncora são os oranges já canônicos da LP; os demais vêm de L escalonado com croma no limite do gamut sRGB, mesma matiz.

| Token | HEX | Tripla RGB | OKLCH | Papel do degrau |
|---|---|---|---|---|
| `--color-brand-50` | `#FFF3ED` | `255 243 237` | `97.2% 0.0153 48.6` | fundo suave de linha ativa, hover de item de lista |
| `--color-brand-100` | `#FFE7DC` | `255 231 220` | `94.4% 0.0303 46.3` | chip/badge de marca no light, seleção |
| `--color-brand-200` | `#FFD1BA` | `255 209 186` | `89.4% 0.0606 48.0` | borda de card destacado no light |
| `--color-brand-300` | `#FFBA97` | `255 186 151` | `84.5% 0.0931 47.9` | texto de marca no **dark** (10,98:1 sobre canvas) |
| `--color-brand-400` | `#FF9F6C` | `255 159 108` | `79.0% 0.1325 48.1` | texto e ícone de marca no **dark** (9,00:1), anel de foco no dark |
| `--color-brand-500` | `#FF8417` | `255 132 23` | `73.8% 0.1808 53.4` | **hover do botão primário** (é o `#FF8417` da LP), glow, realce |
| `--color-brand-600` | `#F87000` | `248 112 0` | `69.9% 0.1902 48.0` | **a marca.** Preenchimento de botão primário, faixas, elementos gráficos |
| `--color-brand-700` | `#CC5C00` | `204 92 0` | `60.5% 0.1633 48.5` | **anel de foco no light**, texto grande sobre papel, fill com texto branco em ≥24px |
| `--color-brand-800` | `#AD4E00` | `173 78 0` | `53.7% 0.1437 49.1` | **texto miúdo sobre papel e sobre card branco** (4,65 / 5,43) |
| `--color-brand-900` | `#753100` | `117 49 0` | `40.1% 0.1093 48.0` | fundo escuro de marca, borda forte, texto sobre brand-50/100 |

`brand-500` foge 5° da matiz (53,4 em vez de 48) porque é o `#FF8417` literal da LP. Mantido como está: fidelidade ao arquivo no ar vale mais que a pureza da matiz num degrau de hover.

### 1.1 Contrastes calculados (WCAG 2.1, razão de luminância)

**Texto branco `#FFFFFF` sobre preenchimento:**

| Fundo | Razão | Veredito |
|---|---|---|
| `brand-500` `#FF8417` | **2,45:1** | reprova em qualquer tamanho |
| `brand-600` `#F87000` | **2,87:1** | reprova em qualquer tamanho |
| `brand-700` `#CC5C00` | **4,12:1** | só AA large (≥24px, ou ≥18,66px bold) |
| `brand-800` `#AD4E00` | **5,43:1** | AA em qualquer tamanho |
| `brand-900` `#753100` | **9,56:1** | AAA |

**Texto tinta `#14170E` sobre preenchimento** (o caminho recomendado):

| Fundo | Razão | Veredito |
|---|---|---|
| `brand-500` `#FF8417` | **7,39:1** | AAA |
| `brand-600` `#F87000` | **6,31:1** | AA em qualquer tamanho, AAA large |
| `brand-700` `#CC5C00` | **4,40:1** | só AA large |
| `brand-800` `#AD4E00` | **3,34:1** | só AA large |
| `brand-900` `#753100` | **1,90:1** | reprova |

**`text-brand-*` sobre os dois fundos claros:**

| Token | sobre papel `#F2EDE3` | sobre card `#FFFFFF` |
|---|---|---|
| `brand-600` | 2,46 reprova | 2,87 reprova |
| `brand-700` | 3,53 AA large | 4,12 AA large |
| `brand-800` | **4,65 AA** | **5,43 AA** |
| `brand-900` | 8,20 AAA | 9,56 AAA |

**`text-brand-*` no dark:**

| Token | canvas `#14170E` | card `#1D2116` | surface `#272B1F` |
|---|---|---|---|
| `brand-300` | 10,98 | 9,93 | 8,88 |
| `brand-400` | 9,00 | 8,14 | 7,28 |
| `brand-500` | 7,39 | 6,68 | 5,98 |
| `brand-600` | 6,31 | 5,70 | 5,10 |

### 1.2 Regras de uso do laranja

| Situação | Regra | Por quê |
|---|---|---|
| Botão primário, faixa, chip preenchido | `bg-brand-600` + **`text-ink`** (nunca `text-white`), hover `bg-brand-500` | 6,31:1 contra 2,87:1. É exatamente o botão da LP |
| Botão primário que precise de texto branco por decisão de produto | `bg-brand-800` + `text-white` (5,43:1) | único degrau que sustenta branco em corpo de texto |
| Texto, link e ícone de marca no **light** | `text-brand-800`. `brand-700` só para ≥24px | 4,65 contra 2,46 do 600 |
| Texto, link e ícone de marca no **dark** | `text-brand-400` (9,00) ou `brand-300` (10,98) | laranja saturado sobre tinta tem folga de sobra |
| Anel de foco | `ring-brand-700` no light, `ring-brand-400` no dark, **sólido, sem `/40`** | alpha 40% cai para 1,63:1; `brand-700` sólido passa 3:1 nos quatro fundos |
| Borda de ênfase | `border-brand-200` no light, `border-brand-500/30` no dark | borda não é texto nem indicador de estado, 3:1 não se aplica |
| Fundo suave | `bg-brand-50` / `bg-brand-100` no light. Tinta em cima dá 16,65 e 15,29 | superfície de marca sem competir com o card |
| Fundo suave no dark | `bg-brand-600/18` (compõe para `#442F12` sobre card; ink em cima 10,83) | evita `brand-900` sólido, que fecha demais |
| Glow e sombra colorida | `brand-500/20` a `/30`, e `--shadow-hover` | decorativo, fora do escopo de contraste |
| **Onde o laranja não pode ir** | `text-brand-600` e `text-brand-500` sobre papel ou card branco. `text-white` sobre 500/600/700. `brand-900` como fundo de texto tinta | todos abaixo de 3:1 |

Os 110 `text-brand-600` do app viram `text-brand-800 dark:text-brand-400`. Os 94 `text-brand-400` e 46 `text-brand-300` já estão em contexto dark e passam sem alteração; conferir caso a caso se algum deles aparece em superfície clara.

---

## 2. O que vira o `gold-*`: verde do CH

O nome do token fica. O valor passa a ser o verde do símbolo CH (`#008810`), que é o acento secundário declarado na decisão de rebranding e no brief ("preservar o contraste entre o C laranja e o H verde"). Matiz OKLCH 143,3.

| Token | HEX | Tripla RGB | OKLCH | Origem |
|---|---|---|---|---|
| `--color-gold-50` | `#EBF9EA` | `235 249 234` | `96.8% 0.0247 143.5` | derivado |
| `--color-gold-100` | `#D6F3D4` | `214 243 212` | `93.5% 0.0513 143.4` | derivado |
| `--color-gold-500` | `#359D36` | `53 157 54` | `61.4% 0.1703 143.3` | derivado |
| `--color-gold-600` | `#008810` | `0 136 16` | `54.4% 0.1803 143.3` | `--green` do CH e da LP |
| `--color-gold-700` | `#00660C` | `0 102 12` | `44.3% 0.1457 143.5` | `--green-area` da LP |

**Contrastes**

| Par | Razão | Veredito |
|---|---|---|
| branco sobre `gold-600` `#008810` | **4,64:1** | AA em qualquer tamanho |
| branco sobre `gold-700` `#00660C` | **7,23:1** | AAA |
| branco sobre `gold-500` `#359D36` | 3,48:1 | só AA large |
| tinta sobre `gold-600` | 3,91:1 | só AA large |
| `text-gold-700` sobre papel | **6,19:1** | AA |
| `text-gold-600` sobre papel | 3,97:1 | só AA large |
| `text-gold-600` sobre card branco | 4,64:1 | AA |
| `gold-600` sobre dark-card `#1D2116` | 3,53:1 | só AA large |

**Regras**

- Preenchimento com texto branco: `gold-600` (4,64) ou `gold-700` (7,23). Nunca `gold-500` com corpo de texto branco.
- Texto verde no light: `gold-700` sobre papel, `gold-600` aceitável sobre card branco.
- Texto verde no dark: nenhum degrau da rampa passa confortavelmente. Usar `#55C264` (o kicker da seção escura da LP), que dá **8,02:1** sobre canvas e **7,25:1** sobre card. Entra como `--color-gold-300: #55C264`, degrau novo, só para dark.
- **Papel do verde**: kicker, olho de seção, marcador de plano/premium, o H da assinatura. Não é um segundo estilo de botão.

**Ressalva que fica registrada:** verde como acento secundário colide semanticamente com "sucesso". O que separa os dois é matiz, não sorte: verde de marca fica em **143 ±6**, verde semântico (`emerald`) em **162 ±6**, e `teal` em **182**. Dezenove graus de distância, mensurável. A seção 5 transforma isso em regra de varredura. Se o colega de produto achar a colisão inaceitável, a alternativa é manter `gold-*` num âmbar terroso (`#AD7B2E` range) como acento de plano/luxo e usar o verde só na assinatura; a spec não recomenda esse caminho porque o verde do CH é patrimônio de marca travado em decisão.

---

## 3. Tokens semânticos, `dark-*` e sombras

Triplas RGB, para trocar via `.dark` no `<html>` como já é hoje.

### 3.1 Light (`:root`)

| Token | HEX | Tripla RGB | Contraste relevante |
|---|---|---|---|
| `--canvas` | `#F2EDE3` | `242 237 227` | papel da LP, literal |
| `--card` | `#FFFFFF` | `255 255 255` | 1,17:1 contra o canvas, o card levanta |
| `--surface` | `#FAF7F0` | `250 247 240` | 1,09:1 contra o canvas |
| `--line` | `#DFD9CB` | `223 217 203` | 1,21:1 contra canvas, 1,41:1 contra card |
| `--ink` | `#14170E` | `20 23 14` | 15,53 sobre canvas, 18,12 sobre card |
| `--muted` | `#5A5E4E` | `90 94 78` | **5,72** sobre canvas, 6,68 sobre card, AA |
| `--faint` | `#6B6D64` | `107 109 100` | **4,50** sobre canvas, 5,25 sobre card, AA |

`--faint` vem do `rgba(20,23,14,.62)` da LP na intenção, não no valor: a LP usa esse alpha como texto secundário e ele dá 6,7:1 sobre papel. No CRM `faint` é o terceiro nível e um valor "bonito" (`#848875`) dá **3,12:1**, reprovado como texto. O valor acima já é o corrigido. Se `faint` for usado só em divisória, ícone desabilitado e decoração (nunca em texto), pode subir para `#848875` `132 136 117`; como há 25 ocorrências de `text-faint`, a spec trava no valor que passa.

### 3.2 Dark (`.dark`)

| Token | HEX | Tripla RGB | Contraste relevante |
|---|---|---|---|
| `--canvas` | `#14170E` | `20 23 14` | tinta da LP. Não é preto puro |
| `--card` | `#1D2116` | `29 33 22` | tinta-2 da LP. 1,11:1 acima do canvas |
| `--surface` | `#272B1F` | `39 43 31` | 1,25:1 acima do canvas |
| `--line` | `#363A2B` | `54 58 43` | 1,55:1 contra canvas, 1,40:1 contra card |
| `--ink` | `#F2EDE3` | `242 237 227` | 15,53 sobre canvas, 14,05 sobre card |
| `--muted` | `#AFB2A0` | `175 178 160` | **8,37** / 7,57, AA |
| `--faint` | `#87897F` | `135 137 127` | **5,11** / **4,62**, AA no pior fundo |

`--faint` do dark também já é o corrigido: o valor natural `#80846F` dá 4,25:1 sobre o card e reprova por pouco.

### 3.3 `dark-bg/card/border/hover` casados

| Token | HEX | Casa com |
|---|---|---|
| `--color-dark-bg` | `#14170E` | `--canvas` do dark |
| `--color-dark-card` | `#1D2116` | `--card` do dark |
| `--color-dark-border` | `#363A2B` | `--line` do dark |
| `--color-dark-hover` | `#40442F` | um degrau acima da linha (1,73:1 sobre canvas) |

**Pendência de arquivo:** `tailwind.config.js` ainda declara `colors.dark` em navy (`#020617`, `#0f172a`, `#1e293b`, `#334155`), duplicando esses quatro tokens com valores de outro tema. Duas fontes de verdade para `dark-bg/card/border/hover` (130 usos somados). A spec manda **remover o bloco `colors.dark` do `tailwind.config.js`** e deixar só o `@theme` do CSS. Enquanto as duas existirem, qual ganha depende da ordem de merge do Tailwind v4 e não está verificado aqui.

### 3.4 Sombras

Hoje: `rgba(27,23,20,…)` (tinta do tema marrom antigo) e `rgba(11,99,84,.12)` (teal 700). Passam a:

```css
--shadow-soft:  0 1px 2px rgba(20, 23, 14, .05), 0 8px 24px rgba(20, 23, 14, .08);
--shadow-hover: 0 12px 32px rgba(204, 92, 0, .12);
```

Sombra é tinta `#14170E` (`20 23 14`), a mesma da página, nunca azul nem cinza neutro. A sombra de hover carrega a cor da marca em `brand-700` (`204 92 0`), que é o laranja que não vira rosa ao diluir.

---

## 4. Tipografia

Fontes da LP: Montserrat variável (a máquina) e Instrument Serif itálico (a pessoa). Ambas existem no Google Fonts, então entram por `next/font/google` em `app/layout.tsx`, mantendo o padrão atual (nada de CDN).

```tsx
import { Montserrat, Instrument_Serif } from 'next/font/google'

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
})

const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
  variable: '--font-instrument',
  display: 'swap',
})
```

### 4.1 Mapeamento dos tokens

| Token | Valor | Papel |
|---|---|---|
| `--font-sans` | `var(--font-montserrat), 'Montserrat', 'Segoe UI', system-ui, sans-serif` | corpo, rótulo, tabela, botão, navegação. Tudo |
| `--font-display` | **a mesma Montserrat** | título de tela. Muda o peso e o tracking, não a família |
| `--font-serif` | `var(--font-instrument), 'Instrument Serif', Georgia, serif` (itálico 400) | a voz humana: fragmento enfatizado dentro do título, citação, frase de estado vazio |

**Por que `--font-display` não recebe a serifa.** Dois motivos medidos, não estéticos. Primeiro: no arquivo da LP quem é display é a própria Montserrat (`h1, h2 { font-weight: 800; letter-spacing: -.042em; line-height: .9 }`); a Instrument Serif aparece só dentro de `h1 em, h2 em` e na classe `.grifo`. Repontar o display para a serifa inverteria a hierarquia da LP. Segundo: Instrument Serif tem **só o peso 400**, e as 86 ocorrências de `font-display` no app estão quase todas em `h1`/`h2` com `font-bold`, o que produziria negrito sintético em 43 arquivos.

### 4.2 Pesos de Montserrat em uso

| Papel | Peso | Tracking | Line-height |
|---|---|---|---|
| Display / h1 de tela | 800 | `-0.042em` | `0.9` |
| h2 | 800 | `-0.04em` | `0.95` |
| h3, título de card | 700 | `-0.02em` | `1.15` |
| Botão, rótulo de aba | 800 | `-0.01em` | `1` |
| Corpo | 400 | `0` | `1.55` |
| Ênfase no corpo | 600 | `0` | `1.55` |
| Kicker, olho de seção, badge | 800, caixa alta | `0.18em` | `1.2` |
| Miúdo, legenda, timestamp | 400 | `0` | `1.4` |

O tracking negativo forte (`-0.042em`) é a assinatura tipográfica da LP e é o que faz Montserrat parar de parecer fonte de sistema. Sem ele, o título fica genérico.

### 4.3 Onde a serifa itálica entra, e onde não entra

**Entra:**
- Fragmento enfatizado dentro de um título de tela de marketing: login, redefinição de senha, `join`, `install/start`, `install/wizard`, `setup`. É o padrão `<h1>Texto <em>grifado</em></h1>` da LP.
- Frase de estado vazio que fala com a pessoa ("nenhuma conversa ainda").
- Citação, depoimento, número-destaque de relatório com legenda editorial.
- Tela de plano/upgrade.

**Não entra, em nenhuma hipótese:**
- Cabeçalho de coluna de tabela, célula, rótulo de campo, placeholder.
- Título de card em lista ou Kanban, nome de contato, nome de etapa.
- Botão, aba, item de navegação, badge, chip, tooltip, toast.
- Qualquer texto abaixo de 18px.
- Qualquer texto que precise de peso acima de 400.

Regra curta: itálico serifado é para **uma frase que alguém lê**, não para **um dado que alguém varre**. Em UI densa o itálico derruba a velocidade de varredura e desalinha a coluna óptica.

---

## 5. Regra dos verdes fixos: critérios para o varredor

São 324 ocorrências de `emerald-*` e 99 de `teal-*` em 54 arquivos. Parte é semântica (fica) e parte é marca disfarçada (vira `brand-*`). O varredor decide por **papel do elemento**, não por tom.

### 5.1 Árvore de decisão (aplicar na ordem)

1. **O elemento comunica estado, resultado ou saúde de algo?** (conectado, online, entregue, pago, concluído, ativo, meta batida, saldo positivo, validação aceita) → **SEMÂNTICO. Fica.** Trocar `emerald`/`teal` cru pelos tokens de status que já existem (`--color-success`, `--color-success-bg`, `--color-success-text`), não por `brand-*`.
2. **O elemento é o caminho principal de ação, ou é decoração de identidade?** (botão primário, link, anel de foco, gradiente de hero, glow de fundo, avatar padrão, ícone de logo, barra de progresso de onboarding, borda de card em destaque) → **MARCA. Vira `brand-*`.**
3. **É o canal WhatsApp?** → **CANAL. Fica no `--color-wa`.** Não é marca nem status.
4. **Sobrou dúvida?** Pergunte: se o dado mudasse de "bom" para "ruim", esse verde mudaria de cor? **Sim → semântico. Não → marca.**

### 5.2 Exemplos concretos do repositório

**SEMÂNTICO, fica:**

| Uso | Onde | Razão |
|---|---|---|
| `bg-emerald-500` como bolinha de status | `app/(protected)/labs/deal-cockpit-mock/DealCockpitMockClient.tsx:144` (`return 'bg-emerald-500'` num seletor de estado) | a cor é o dado |
| `bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/20` como badge de estado | `DealCockpitRealClient.tsx:293,359` | badge de saúde do negócio |
| `text-emerald-500` no `CheckCircle2` | `app/login/page.tsx:93` | confirmação de ação |
| `bg-emerald-50` de card de sucesso, `bg-emerald-500/10` de faixa de confirmação | vários | fundo de mensagem positiva |
| `from-emerald-400 to-emerald-500` na barra de meta quando `isOnTrack` | `features/reports/ReportsPage.tsx:246` (o `else` é âmbar) | verde/âmbar é a escala do dado |
| `c.includes('emerald') → 'green'` | `DealCockpitRealClient.tsx:328` | mapeamento de string para categoria semântica. **Não tocar**, e verificar se o produtor dessa string continua emitindo `emerald` |

**MARCA, vira `brand-*`:**

| Uso | Onde | Passa a ser |
|---|---|---|
| `bg-gradient-to-r from-emerald-500 to-cyan-500 … text-white font-bold text-xl` (botão gigante de avançar) | `app/install/wizard/page.tsx:1893` | `bg-brand-600 text-ink hover:bg-brand-500`, sem gradiente |
| `from-emerald-500 to-emerald-600 … ring-1 ring-emerald-600/50` (botão primário do inbox) | `features/inbox/components/InboxFocusView.tsx:466` | `bg-brand-600 text-ink hover:bg-brand-500 ring-brand-700` |
| `text-emerald-600` em link | vários (13 ocorrências de `text-emerald-600`) | `text-brand-800 dark:text-brand-400` |
| `focus-visible:outline-teal-400` (7 ocorrências) | `features/automations/AutomationFlowMap.tsx:547,601,647,664` | `outline-brand-700 dark:outline-brand-400`, sólido |
| `from-emerald-500/20 to-teal-500/20` como gradiente de cartão de etapa | `app/install/start/page.tsx:59,838` | `bg-brand-600/12` chapado, sem gradiente |
| `bg-teal-500/12` como blur de fundo | `app/install/wizard/page.tsx:1351` | `bg-brand-600/12` |
| `from-emerald-400 to-cyan-400` em avatar / disco de conclusão | `install/start:910`, `install/wizard:1813`, `TenantConversationsPage:873,940` | `bg-brand-600` chapado com `text-ink`, ou o CH em `brand-600` + `gold-600` |
| `'from-emerald-500 to-teal-500'` na paleta rotativa de avatar | `features/profile/ProfilePage.tsx:85`, `features/settings/UsersPage.tsx:52` | entrada da paleta vira laranja/verde do CH; as outras entradas da lista ficam |

### 5.3 O `teal` usado como marca no dark

`teal` é o caso mais fácil: **ele nunca é semântico no app.** Matiz 180 a 185 não é verde de sucesso, é o antigo `brand` do tema da clínica sobrevivendo solto. Regra: **todo `teal-*` vira `brand-*`**, sem triagem caso a caso, com este mapeamento de degrau (mantém a luminosidade percebida):

| De | Para | L de origem | L de destino |
|---|---|---|---|
| `teal-200` `#99F6E4` | `brand-200` | 91,0% | 89,4% |
| `teal-300` `#5EEAD4` | `brand-300` | 85,5% | 84,5% |
| `teal-400` `#2DD4BF` | `brand-400` | 78,5% | 79,0% |
| `teal-500` `#14B8A6` | `brand-600` | 70,4% | 69,9% |
| `teal-600` `#0D9488` | `brand-700` | 60,0% | 60,5% |

Os gradientes com verde morrem junto: 14 `from-(emerald|teal)-*` e 24 `to-(emerald|teal)-*`, entre eles 7 pares `emerald → teal` e 5 pares `emerald → cyan`. Todos viram cor chapada de `brand-*`. Gradiente de duas matizes vizinhas é ruído, não é hierarquia, e a LP não tem nenhum.

### 5.4 Critério objetivo de matiz, para conferência automática

Para um script de auditoria depois da varredura:

| Faixa de matiz OKLCH | Classificação | Deve aparecer em |
|---|---|---|
| 40 a 56 | marca, laranja | `brand-*` |
| 137 a 149 | marca, verde do CH | `gold-*` |
| 149 a 155 | canal WhatsApp | `--color-wa` |
| 156 a 170 | semântico, sucesso | `--color-success*` |
| 175 a 190 (`teal`) | **nada.** Resíduo do tema antigo | zero ocorrências |

`#1FA855` (o `--color-wa` de hoje) fica em matiz 150,8, ou seja encostado no verde semântico. E branco em cima dele dá **3,09:1**, reprovado. A LP já resolveu: `#25D366` com texto tinta dá **9,14:1**. Recomendação: `--color-wa: #25D366` (`37 211 102`), sempre com `text-ink`.

---

## 6. Manifest e ícones

`app/manifest.ts` hoje tem `background_color: '#ffffff'` e `theme_color: '#0ea5e9'` (um azul que não pertence a tema nenhum do produto).

| Campo | Valor | Razão |
|---|---|---|
| `theme_color` | `#14170E` | `app/layout.tsx` fixa `className="dark"` no `<html>`, então o modo padrão do app é escuro. A barra do sistema tem que casar com o canvas escuro |
| `background_color` | `#14170E` | tela de splash igual ao canvas do modo padrão. Branco puro hoje produz um flash de tela clara antes do app |
| `name` / `short_name` | manter `Base CRM` até a decisão de nome do produto | o rebranding CENNO é da empresa, não do produto. A decisão de 2026-09-06 não renomeia o CRM |

Se o modo claro virar opção de usuário, acrescentar o par de meta no `viewport` em vez de mudar o manifest:

```tsx
export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#14170E' },
    { media: '(prefers-color-scheme: light)', color: '#F2EDE3' },
  ],
}
```

### 6.1 Cor do tile do ícone PWA: sobre tinta

O símbolo é o CH de `site-claude/ch.svg`: arco em `#F87000` (traço 59 de 545 de largura, 10,8%) mais a haste e a travessa em `#008810`.

Decisão: **CH sobre tinta `#14170E`**, tanto no `icon.svg` quanto no `maskable.svg`. Medido:

| Fundo | Laranja `#F87000` | Verde `#008810` |
|---|---|---|
| tinta `#14170E` | **6,31:1** | **3,91:1** |
| papel `#F2EDE3` | 2,46:1 | 3,97:1 |

Sobre papel o arco laranja quase desaparece (2,46:1) e o símbolo perde a metade que mais identifica a marca. Sobre tinta as duas cores se sustentam, e é coerente com a assinatura que já existe (`assets/marca-cenno/cenno-logo-horizontal-fundo-preto-v1.png`) e com o app abrir em modo escuro.

Especificação dos arquivos:

| Arquivo | Conteúdo |
|---|---|
| `public/icons/icon.svg` | canvas quadrado `viewBox="0 0 512 512"`, fundo `#14170E`, CH centralizado ocupando 64% da largura. O `ch.svg` é 545×381 (deitado), precisa de caixa quadrada com respiro, não de esticar |
| `public/icons/maskable.svg` | mesmo canvas, CH em **56%** da largura para caber na safe zone circular de 80% dos lançadores Android |
| `public/favicon.svg` | CH sobre tinta, traço do arco engrossado de 10,8% para **14%** da largura e travessa do H de 13,9% para **17%** da altura. Em 16px o traço original fica em 1,7px e o símbolo embola |
| `public/favicon.ico` | 32px e 16px derivados do SVG acima |
| `apple-touch-icon.png` | 180×180, fundo `#14170E` chapado (iOS não respeita transparência) |

Não usar o CH isolado como identificação única em contexto ambíguo: o brief trava que "o CH isolado não deve identificar uma das duas marcas quando o contexto for ambíguo". Dentro do app o contexto é inequívoco (é o CRM da CENNO), então o ícone isolado está liberado; em material comercial exportado do CRM (PDF de proposta, relatório), a assinatura tem que trazer o nome.

---

## 7. Mecanismo de tema por organização

Só a regra visual. A mecânica de resolução de qual tema carregar fica para a implementação.

### 7.1 Estrutura

- **CENNO é o padrão.** Os valores das seções 1 a 4 vivem no `@theme` e no `:root`/`. dark` de `app/globals.css`, sem seletor de marca. Organização sem tema declarado recebe CENNO.
- **A clínica é a exceção nomeada.** Os valores de hoje (teal `brand-*`, dourado `gold-*`, creme `canvas`, marrom `dark-*`) migram para baixo de `[data-brand="clinica"]`, redeclarando **apenas** os tokens de cor e de fonte. Nada de layout.
- **O atributo é do `<html>`**, ao lado da classe `dark`, porque as duas dimensões são ortogonais: `<html class="dark" data-brand="clinica">` tem que funcionar.
- Cada tema declara os dois modos: `[data-brand="clinica"]` para o light e `[data-brand="clinica"].dark` para o escuro.
- Nenhum componente lê a marca. Componente lê token. Se um arquivo `.tsx` precisar de `if (brand === 'clinica')`, o token está faltando.

```css
/* padrão: CENNO, sem seletor */
:root { --canvas: 242 237 227; /* … */ }
.dark { --canvas: 20 23 14;    /* … */ }

/* exceção nomeada */
[data-brand="clinica"]      { --canvas: 236 226 210; /* … */ }
[data-brand="clinica"].dark { --canvas: 19 17 15;    /* … */ }
```

Os degraus `brand-*` e `gold-*` estão hoje no `@theme` (não em `:root`), então não são sobrescrevíveis por seletor. Para o tema por organização funcionar, eles precisam virar `@theme inline` apontando para variáveis de `:root`, no mesmo padrão dos semânticos:

```css
@theme inline {
  --color-brand-600: rgb(var(--brand-600));
  /* … os 10 degraus, idem gold-* … */
}
:root                  { --brand-600: 248 112 0;  /* CENNO  */ }
[data-brand="clinica"] { --brand-600: 14 125 105; /* teal   */ }
```

### 7.2 O que não muda de forma entre os temas

Isto é o que mantém os dois como o mesmo produto. **Tema troca cor e família tipográfica. Nada além disso.**

| Dimensão | Regra |
|---|---|
| Raios de borda | Idênticos. A escala do CRM (`rounded-lg`, `xl`, `2xl`, `full`) fica. **A LP não tem raio nenhum** (`.botao` e `.topo-cta` são retângulos), e importar isso reformaria todo componente do app. Raio é decisão de produto, não de marca |
| Espaçamento e grade | Idênticos. Mesmos paddings, mesmas alturas de controle, mesma densidade de tabela e de Kanban |
| Tipos de sombra | Mesma estrutura (`--shadow-soft` de dois níveis, `--shadow-hover` de um). Só a **cor** muda por tema |
| Escala tipográfica | Mesmos tamanhos e line-heights. Só família, peso e tracking mudam por tema |
| Bordas | Mesma espessura (1px) e mesmo papel. Só a cor muda |
| Duração e easing de transição | Idênticos nos dois temas |
| Iconografia | Lucide nos dois, mesmo peso de traço, mesmo tamanho |
| Layout, hierarquia e posição de tudo | Idênticos. Nenhum tema ganha ou perde elemento, nenhum tema move um botão |
| Estados de componente | Os nove estados (default, hover, focus, active, disabled, loading, empty, error, success) existem nos dois com a mesma semântica |

Regra de aceitação: uma captura de tela de cada tema, lado a lado, tem que ser reconhecível como **a mesma tela pintada diferente**, não como dois produtos. Se alguma diferença exigir explicação além de "a cor mudou", o tema invadiu o produto.

---

## 8. Bloco copiável para `app/globals.css`

Substitui os blocos correspondentes. Não repete o que fica igual.

```css
@theme {
  /* Tipografia */
  --font-sans: var(--font-montserrat), 'Montserrat', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-display: var(--font-montserrat), 'Montserrat', 'Segoe UI', system-ui, sans-serif;
  --font-serif: var(--font-instrument), 'Instrument Serif', Georgia, serif;

  /* WhatsApp: verde oficial, sempre com text-ink (9,14:1). O #1fa855 anterior
     dava 3,09:1 com branco e encostava no verde semântico (matiz 150,8). */
  --color-wa: #25D366;

  /* Dark shell, casado com --canvas/--card/--line do bloco .dark */
  --color-dark-bg: #14170E;
  --color-dark-card: #1D2116;
  --color-dark-border: #363A2B;
  --color-dark-hover: #40442F;
}

/* brand-* e gold-* em @theme inline, para o tema por organização poder trocar */
@theme inline {
  --color-brand-50:  rgb(var(--brand-50));
  --color-brand-100: rgb(var(--brand-100));
  --color-brand-200: rgb(var(--brand-200));
  --color-brand-300: rgb(var(--brand-300));
  --color-brand-400: rgb(var(--brand-400));
  --color-brand-500: rgb(var(--brand-500));
  --color-brand-600: rgb(var(--brand-600));
  --color-brand-700: rgb(var(--brand-700));
  --color-brand-800: rgb(var(--brand-800));
  --color-brand-900: rgb(var(--brand-900));

  --color-gold-50:  rgb(var(--gold-50));
  --color-gold-100: rgb(var(--gold-100));
  --color-gold-300: rgb(var(--gold-300));
  --color-gold-500: rgb(var(--gold-500));
  --color-gold-600: rgb(var(--gold-600));
  --color-gold-700: rgb(var(--gold-700));

  --color-canvas:  rgb(var(--canvas));
  --color-card:    rgb(var(--card));
  --color-surface: rgb(var(--surface));
  --color-line:    rgb(var(--line));
  --color-ink:     rgb(var(--ink));
  --color-muted:   rgb(var(--muted));
  --color-faint:   rgb(var(--faint));

  --shadow-soft:  0 1px 2px rgba(20, 23, 14, .05), 0 8px 24px rgba(20, 23, 14, .08);
  --shadow-hover: 0 12px 32px rgba(204, 92, 0, .12);
}

:root {
  /* CENNO, laranja matiz 48. 600 = #F87000 exato. 500 = #FF8417, o hover da LP. */
  --brand-50:  255 243 237;
  --brand-100: 255 231 220;
  --brand-200: 255 209 186;
  --brand-300: 255 186 151;
  --brand-400: 255 159 108;
  --brand-500: 255 132  23;
  --brand-600: 248 112   0;
  --brand-700: 204  92   0;
  --brand-800: 173  78   0;
  --brand-900: 117  49   0;

  /* CENNO, verde do CH matiz 143,3. Mantém o NOME gold-*. */
  --gold-50:  235 249 234;
  --gold-100: 214 243 212;
  --gold-300:  85 194 100;  /* só dark: 8,02:1 sobre canvas */
  --gold-500:  53 157  54;
  --gold-600:   0 136  16;
  --gold-700:   0 102  12;

  /* Semânticos light: papel #F2EDE3 / tinta #14170E */
  --canvas:  242 237 227;
  --card:    255 255 255;
  --surface: 250 247 240;
  --line:    223 217 203;
  --ink:      20  23  14;
  --muted:    90  94  78;
  --faint:   107 109 100;
}

.dark {
  /* Semânticos dark: tinta #14170E / tinta-2 #1D2116. Não é preto puro. */
  --canvas:   20  23  14;
  --card:     29  33  22;
  --surface:  39  43  31;
  --line:     54  58  43;
  --ink:     242 237 227;
  --muted:   175 178 160;
  --faint:   135 137 127;
}
```

Fora deste bloco, na mesma passada: remover `colors.dark` do `tailwind.config.js` (seção 3.3) e resolver a duplicação de `--color-surface` / `--color-muted` (seção 0).

### 8.1 Ordem de execução sugerida para o Senku

1. Resolver a duplicação de `--color-surface` / `--color-muted` e remover `colors.dark` do `tailwind.config.js`. Nenhuma cor nova ainda. Captura de tela antes e depois: tem que dar zero pixel de diferença ou explicar cada um.
2. Trocar as fontes no `layout.tsx` e os três tokens de família. Conferir que nenhum `font-display` virou negrito sintético.
3. Aplicar os valores de `brand-*`, `gold-*` e semânticos. Aqui a tela muda de cor inteira.
4. Varredura do achado A: `text-white` sobre `bg-brand-500/600` vira `text-ink` (124 ocorrências somadas).
5. Varredura do achado B: `text-brand-600` vira `text-brand-800 dark:text-brand-400` (110 ocorrências).
6. Varredura do achado C: anel de foco sólido em `brand-700` / `dark:brand-400` (151 ocorrências somadas).
7. Varredura dos verdes fixos pela seção 5. `teal-*` primeiro, porque é mecânico.
8. Manifest e ícones.
9. Mover o tema da clínica para `[data-brand="clinica"]` e conferir as duas telas lado a lado.

---

## 9. Auto-critique M7

Checklist anti-slop rodado contra esta spec.

### 9.1 Detecção de padrões

| Padrão | Presente? | Nota |
|---|---|---|
| Light beam horizontal genérico | Não | nenhum efeito especificado |
| Aberração cromática sem motivo | Não | |
| Partículas decorativas | Não | |
| Breathing / glow pulse | Não | a spec só menciona glow como opacidade estática de `brand-500/20` |
| Vinheta radial | Não | a spec **remove** os `bg-teal-500/12` de blur do wizard, trocando por cor chapada |
| Scan-line | Não | |
| Gradiente roxo neon (#7C3AED range) | Não | matiz 48 e 143. A spec elimina os 38 usos de gradiente com verde |
| Inter / Roboto / Arial como fonte principal | Não | Montserrat + Instrument Serif. Nenhuma das duas é fonte de sistema |
| Fundo branco puro em app | **Parcial** | `--card: #FFFFFF` no light. Assumido de propósito: o canvas é `#F2EDE3` e o card branco é o que faz o card levantar (1,17:1). Branco puro só na superfície elevada, nunca na página |
| Fundo preto puro | Não | `#14170E`, a tinta da LP |
| Contraste abaixo de 4,5:1 em texto normal | **Encontrado e corrigido** | três achados na seção 0, mais `--faint` nos dois modos (3,12 e 4,25 corrigidos para 4,50 e 4,62) |
| Mais de 3 cores primárias sem sistema semântico | Não | duas de marca (laranja, verde), com faixa de matiz declarada e separação de 19° do verde semântico |
| Mistura de mais de 2 famílias tipográficas | Não | duas |
| Corpo de texto abaixo de 16px | Não avaliado | a spec não muda a escala de tamanho. Fora de escopo declarado |
| Paleta sem documentação semântica | Não | todo degrau tem papel declarado |
| Logo sem versão para fundo escuro | Não | o ícone é especificado sobre tinta, que é o caso escuro |
| Botão sem estado definido | Não | seção 1.2 cobre fill, hover, foco e texto |

Zero de oito no bloco crítico. Passa.

### 9.2 Onde esta spec pode estar errada

- **A colisão verde marca / verde sucesso é a fraqueza real.** Resolvi por matiz (143 contra 162) e por papel (o verde de marca não é botão). Dezenove graus de matiz é uma diferença que um olho treinado distingue e um olho apressado, num badge de 8px, talvez não. Se na tela montada o `gold-600` de um marcador de plano for confundido com "pago", a saída é escurecer `gold-*` para a faixa `#00660C` e usar o `emerald` claro no sucesso, ampliando a distância por luminosidade além da matiz. Não decidi isso agora porque precisa de tela montada, não de planilha.
- **Texto tinta em botão laranja é a escolha certa e vai parecer estranha na primeira vez.** O reflexo de CRM é botão colorido com texto branco. A LP faz o contrário e está certa; mesmo assim, espere a reação "o botão parece desativado". Não é: 6,31:1 contra os 2,87:1 do branco.
- **`brand-500` foge 5° da matiz.** Escolha deliberada por fidelidade ao `#FF8417` da LP. Quem quiser a rampa perfeitamente uniforme usa `#FF8511` (matiz 48) e perde a correspondência literal com o arquivo no ar.
- **A compressão do topo da rampa é inevitável.** Entre `#F87000` (L 69,9%) e o branco sobra pouco espaço perceptual, então 400 e 500 ficam próximos (79% e 73,8%). É característica de laranja, não defeito da derivação; a rampa `orange` do próprio Tailwind tem a mesma compressão.
- **Não rodei nenhum pixel.** Tudo aqui é medição de cor e contagem de ocorrência. A primeira tela montada vai contradizer alguma coisa desta spec, e quando contradizer, a tela ganha.

---

## 10. O que não foi verificado

1. **Qual definição de `--color-surface` e `--color-muted` ganha em runtime.** Não existe build em `.next/` nesta máquina, então não li o CSS compilado. A leitura do fonte indica que o segundo `:root` (OKLCH) vem depois do `@theme inline` e, com a mesma especificidade, ganharia. Confirmar com `grep -- "--color-surface:" .next/static/css/*.css` depois de um build antes de mexer.
2. **Quem ganha entre `colors.dark` do `tailwind.config.js` e `--color-dark-*` do `@theme`.** Os dois existem com valores de temas diferentes. Não testei a ordem de merge do Tailwind v4 com `@config`.
3. **Se os 94 `text-brand-400` e 46 `text-brand-300` estão todos em superfície escura.** Contei as ocorrências, não auditei o fundo de cada uma. Em superfície clara os dois reprovam (1,73:1 e 1,41:1 sobre papel).
4. **Se algum `emerald` classificado como semântico está em superfície de marca.** A triagem da seção 5.2 saiu de amostra de código lido, não de varredura das 423 ocorrências uma por uma.
5. **Renderização real de Montserrat variável e Instrument Serif itálico pelo `next/font/google`.** Não subi o app. Confirmei que as duas famílias existem no catálogo do Google Fonts pelo uso na LP (que serve `woff2` local), não pelo pacote do `next/font`.
6. **Qual é o degrau exato de `teal` em cada um dos 99 usos.** O mapeamento de 5.3 é por luminosidade percebida e assume os valores padrão do Tailwind para `teal-200..600`.
7. **Percepção do Junior sobre o botão com texto tinta.** É a decisão mais visível da spec e ele não viu ainda.
8. **Nome do produto no manifest.** Mantive `Base CRM`. A decisão de rebranding é da empresa e não fala do nome do CRM.

---

## Handoff

**Senku** implementa, na ordem da seção 8.1. Os valores estão todos em hex e tripla RGB, prontos para colar.

**Vegapunk** entra só se os arquivos de ícone (`icon.svg`, `maskable.svg`, `favicon.svg`, `apple-touch-icon.png`) tiverem que ser gerados em vez de derivados do `ch.svg` por composição direta. A especificação de canvas, proporção e engrossamento de traço está na seção 6.1.

## Emenda de 21/09/2026: fundo escuro em preto profundo

Decisão do Junior depois de ver o CRM na prévia: "o fundo do CRM ficou meio esverdeado, quero ele mais puxado para o preto a versão escura". A tinta `#14170E` tem o verde (23) acima do vermelho (20) e do azul (14). Ele escolheu, entre quatro opções comparadas em tamanho real, a **D, preto profundo**. Vale só para o modo escuro do tema CENNO; a tinta `#14170E` continua sendo o texto do modo claro, o texto sobre o laranja (`on-brand`) e o fundo dos ícones do app. O tema da clínica não muda.

| Token (dark) | Antes | Agora |
|---|---|---|
| `--canvas` / `--color-bg` / `--color-dark-bg` | `#14170E` | `#0A0908` (`10 9 8`) |
| `--card` / `--color-surface` / `--color-dark-card` | `#1D2116` | `#161412` (`22 20 18`) |
| `--surface` / `--color-muted` / `--dots-color` | `#272B1F` | `#1F1D1A` (`31 29 26`) |
| `--line` / `--color-border` / `--color-dark-border` | `#363A2B` | `#2E2B27` (`46 43 39`) |
| `--color-dark-hover` | `#40442F` | `#3A3632` |
| `--muted` / `--color-text-muted` | `#AFB2A0` | `#B1ADA4` (`177 173 164`) |
| `--faint` / `--color-text-subtle` | `#87897F` | `#8B877F` (`139 135 127`) |
| `--color-text-secondary` | `#D3D2C6` | `#D4D0C8` |
| `manifest` `theme_color` / `background_color` | `#14170E` | `#0A0908` |

Contraste medido na página de comparação (cálculo WCAG a partir das próprias cores): texto principal `#F2EDE3` sobre o fundo acima de 17:1; texto secundário e fraco sobre o cartão acima de 4,5:1.
