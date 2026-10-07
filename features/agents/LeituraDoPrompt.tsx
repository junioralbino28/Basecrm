'use client';

import React from 'react';
import { dividirEmSecoes, pedacosDaLinha } from '@/lib/agents/leituraDoPrompt';

const ITEM_DE_LISTA = /^\s*[-*]\s+/;

/** Leitura formatada do prompt: seções com título, listas e as variáveis como etiquetas. Sempre texto, nunca HTML (G16). */
export function LeituraDoPrompt({ texto }: { texto: string }) {
  const secoes = React.useMemo(() => dividirEmSecoes(texto), [texto]);
  return (
    <div className="space-y-5">
      {secoes.map((secao, i) => {
        if (secao.titulo === null && secao.linhas.every((l) => l.trim() === '')) return null;
        return (
          <section key={i} className="space-y-2">
            {secao.titulo ? (
              <header>
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{secao.titulo}</h3>
                {secao.nota ? <p className="text-xs text-slate-500 dark:text-slate-400">{secao.nota}</p> : null}
              </header>
            ) : null}
            {secao.complemento ? (
              <p className="text-sm leading-6 text-slate-800 dark:text-slate-100">
                <Linha texto={secao.complemento} />
              </p>
            ) : null}
            <Blocos linhas={secao.linhas} />
          </section>
        );
      })}
    </div>
  );
}

function Blocos({ linhas }: { linhas: string[] }) {
  // Linhas que começam com "- " ou "* " viram lista; o resto, parágrafo; linha em branco separa.
  const blocos: Array<{ tipo: 'lista' | 'paragrafo'; linhas: string[] }> = [];
  for (const linha of linhas) {
    if (linha.trim() === '') {
      blocos.push({ tipo: 'paragrafo', linhas: [] });
      continue;
    }
    const tipo = ITEM_DE_LISTA.test(linha) ? 'lista' : 'paragrafo';
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && ultimo.tipo === tipo && ultimo.linhas.length > 0) ultimo.linhas.push(linha);
    else blocos.push({ tipo, linhas: [linha] });
  }
  return (
    <>
      {blocos
        .filter((b) => b.linhas.length > 0)
        .map((b, i) =>
          b.tipo === 'lista' ? (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800 dark:text-slate-100">
              {b.linhas.map((l, j) => (
                <li key={j}>
                  <Linha texto={l.replace(ITEM_DE_LISTA, '')} />
                </li>
              ))}
            </ul>
          ) : (
            <p key={i} className="text-sm leading-6 text-slate-800 dark:text-slate-100">
              {b.linhas.map((l, j) => (
                <React.Fragment key={j}>
                  {j > 0 ? <br /> : null}
                  <Linha texto={l} />
                </React.Fragment>
              ))}
            </p>
          ),
        )}
    </>
  );
}

function Linha({ texto }: { texto: string }) {
  return (
    <>
      {pedacosDaLinha(texto).map((p, i) =>
        p.tipo === 'texto' ? (
          <React.Fragment key={i}>{p.texto}</React.Fragment>
        ) : (
          <span
            key={i}
            title={p.conhecida ? 'Preenchida pelo sistema em cada resposta' : 'Variável desconhecida: bloqueia Publicar'}
            className={
              p.conhecida
                ? 'mx-0.5 inline-flex rounded-md border border-brand-200 bg-brand-50 px-1.5 font-mono text-xs text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                : 'mx-0.5 inline-flex rounded-md border border-rose-300 bg-rose-50 px-1.5 font-mono text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
            }
          >
            {p.texto}
          </span>
        ),
      )}
    </>
  );
}
