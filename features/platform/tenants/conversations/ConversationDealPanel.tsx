'use client';

/**
 * Funil, etiquetas e origem DENTRO da conversa (Junior, 23/09/2026).
 *
 * "A maior parte do tempo o SDR/secretária vai passar conversando com o lead na aba
 * conversa; seria bom mudar a etapa do funil por ali mesmo, assim como colocar tags,
 * dizer se veio de anúncio, tipo de serviço que deseja."
 *
 * Nada aqui é campo novo: o CRM já tem funil (`board_stages`), etiquetas com CATEGORIA
 * (é onde "tipo de serviço" encaixa, sem inventar campo) e origem (`lead_sources`).
 * Este painel só traz esses controles para onde o atendimento acontece, reusando os
 * MESMOS componentes do detalhe do negócio — duas telas, um comportamento só.
 *
 * A troca de etapa passa por `useMoveDealSimple`, que é a fonte única de movimentação:
 * ela detecta ganho/perda, grava histórico, atualiza o ciclo de vida do contato e dispara
 * a automação de funil seguinte. Um `update` cru em `stage_id` pularia tudo isso em
 * silêncio — o card mudaria de coluna e o resto do CRM não ficaria sabendo.
 */

import React from 'react';
import { Loader2, Megaphone, Tag as TagIcon } from 'lucide-react';
import type {
  ConversationThreadAdClick,
  ConversationThreadEntryPoint,
} from '@/lib/conversations/types';
import { useDeal } from '@/lib/query/hooks/useDealsQuery';
import { useBoards } from '@/lib/query/hooks/useBoardsQuery';
import { useMoveDealSimple } from '@/lib/query/hooks/useMoveDeal';
import { useHasPermission } from '@/lib/auth/useHasPermission';
import { DealTagSelector } from '@/features/tags/DealTagSelector';
import { DealOriginSelector } from '@/features/tags/DealOriginSelector';

const CAIXA =
  'rounded-2xl border border-slate-700 bg-[#111b21] px-3 py-2';
const ROTULO =
  'mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500';

function maiuscula(valor: string) {
  return valor.charAt(0).toUpperCase() + valor.slice(1);
}

/**
 * Tradução dos pontos de entrada que o WhatsApp manda quando NÃO houve anúncio pago. O valor cru
 * (`post_cta`) não diz nada a quem atende; o texto aqui diz. Origem desconhecida cai no cru mesmo,
 * em vez de virar "outro caminho" — assim dá para descobrir o que é.
 */
const PONTO_DE_ENTRADA: Record<string, string> = {
  post_cta: 'botão de uma publicação (post ou Reels)',
  profile_cta: 'botão do perfil',
  bio_link: 'link da bio',
};

/**
 * De onde o lead veio, lido do que o WhatsApp entregou no primeiro clique.
 *
 * Duas procedências DIFERENTES, e a distinção é o ponto da caixa:
 *
 * 1. `adClick` — anúncio pago. Traz `ctwa_clid`, que é a única chave que liga a pessoa ao anúncio
 *    na Meta. Só isto vira conversão de campanha.
 * 2. `entryPoint` — orgânico: botão do perfil, CTA de uma publicação ou Reels. O WhatsApp sempre
 *    mandou (`contextInfo.entryPointConversion*`) e o CRM descartava até 23/09/2026; essas
 *    conversas entravam sem origem nenhuma. Não tem `ctwa_clid`, então NÃO conta como conversão —
 *    e a caixa diz isso em voz alta, senão alguém soma laranja com maçã no relatório.
 *
 * Ausência dos dois NÃO significa "veio orgânico": significa que a conversa não trouxe procedência
 * (começou antes do rastreio, veio por indicação, pelo número salvo…). Por isso o texto não afirma
 * origem quando não há dado.
 */
function DeOndeVeio({
  adClick,
  entryPoint,
}: {
  adClick: ConversationThreadAdClick | null;
  entryPoint: ConversationThreadEntryPoint | null;
}) {
  const plataforma = adClick?.sourceApp ? maiuscula(adClick.sourceApp) : null;
  const rede = entryPoint?.app ? maiuscula(entryPoint.app) : null;
  const caminho = entryPoint?.source
    ? PONTO_DE_ENTRADA[entryPoint.source] ?? `pelo caminho "${entryPoint.source}"`
    : null;

  return (
    <div className={`${CAIXA} lg:col-span-2`}>
      <p className={ROTULO}>
        <Megaphone size={12} />
        De onde veio
      </p>
      {adClick ? (
        <div className="space-y-0.5 text-sm text-slate-100">
          <p className="font-semibold">
            Anúncio{plataforma ? ` no ${plataforma}` : ''}
            {adClick.title ? ` · ${adClick.title}` : ''}
          </p>
          {adClick.sourceId ? (
            <p className="text-[11px] text-slate-400">Anúncio {adClick.sourceId}</p>
          ) : null}
        </div>
      ) : entryPoint && (rede || caminho) ? (
        // Veio do orgânico: dizer isso é bem melhor que silêncio, mas NÃO é anúncio — a Meta não
        // liga esta conversa a campanha nenhuma, e a caixa precisa deixar isso claro.
        <div className="space-y-0.5 text-sm text-slate-100">
          <p className="font-semibold">
            {rede ?? 'Rede social'}
            {caminho ? ` · ${caminho}` : ''}
          </p>
          <p className="text-[11px] text-slate-400">
            Não é anúncio pago: não conta como conversão de campanha.
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Esta conversa não trouxe etiqueta de clique de anúncio. Pode ter vindo de outro caminho
          (indicação, número salvo) ou ter começado antes do rastreio.
        </p>
      )}
    </div>
  );
}

export function ConversationDealPanel({
  organizationId,
  dealId,
  adClick = null,
  entryPoint = null,
}: {
  organizationId: string;
  /** `null` quando a conversa ainda não virou negócio (acontece em conversa de teste). */
  dealId: string | null;
  /** O que o WhatsApp entregou sobre o clique no anúncio, quando houve. */
  adClick?: ConversationThreadAdClick | null;
  /** De onde a pessoa saiu quando NAO houve anuncio pago (botao do perfil, CTA de publicacao). */
  entryPoint?: ConversationThreadEntryPoint | null;
}) {
  const { data: deal, isLoading: carregandoNegocio } = useDeal(dealId || undefined);
  const { data: boards = [] } = useBoards();
  const canAssignTags = useHasPermission('tags.assign') === true;
  const canManageTags = useHasPermission('tags.manage') === true;
  const canAssignOrigin = useHasPermission('lead_sources.assign') === true;
  // `funnels.move` e a MESMA permissao que o quadro usa para arrastar card entre colunas:
  // quem nao pode mover no funil tambem nao move pela conversa.
  const canMove = useHasPermission('funnels.move') === true;

  const board = React.useMemo(
    () => boards.find((b) => b.id === deal?.boardId) ?? null,
    [boards, deal?.boardId],
  );
  const { moveDeal, isMoving } = useMoveDealSimple(board);

  // Perda pede motivo: sem ele o relatório de perdas fica cego. O campo aparece só quando
  // a etapa escolhida É a de perda, e o movimento só acontece no "Confirmar".
  const [perdaPendente, setPerdaPendente] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState('');
  const [erro, setErro] = React.useState<string | null>(null);

  if (!dealId) {
    return (
      <div className="grid gap-2">
        <DeOndeVeio adClick={adClick} entryPoint={entryPoint} />
        <div className={`${CAIXA} text-xs text-slate-400`}>
          Esta conversa ainda não virou negócio, então não tem etapa nem etiquetas.
          Leads que chegam pelo anúncio já nascem com negócio.
        </div>
      </div>
    );
  }

  if (carregandoNegocio || !deal) {
    return (
      <div className={`${CAIXA} flex items-center gap-2 text-xs text-slate-400`}>
        <Loader2 size={14} className="animate-spin" /> Carregando o negócio…
      </div>
    );
  }

  async function mover(etapaId: string, motivoDaPerda?: string) {
    setErro(null);
    try {
      await moveDeal(deal!, etapaId, motivoDaPerda);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu pra mudar a etapa.');
    }
  }

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <DeOndeVeio adClick={adClick} entryPoint={entryPoint} />
      <div className={CAIXA}>
        <label className={ROTULO} htmlFor="conversa-etapa">
          <TagIcon size={12} />
          Etapa no funil{board ? ` · ${board.name}` : ''}
        </label>
        <select
          id="conversa-etapa"
          className="w-full bg-transparent text-sm text-slate-100 outline-none disabled:opacity-60"
          value={deal.status || ''}
          disabled={!canMove || isMoving || !board}
          onChange={(event) => {
            const alvo = event.target.value;
            if (!alvo || alvo === deal.status) return;
            if (board?.lostStageId && alvo === board.lostStageId) {
              setMotivo('');
              setPerdaPendente(alvo);
              return;
            }
            void mover(alvo);
          }}
        >
          {(board?.stages ?? []).map((etapa) => (
            <option key={etapa.id} value={etapa.id}>
              {etapa.label}
            </option>
          ))}
        </select>
        {isMoving ? (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 size={11} className="animate-spin" /> Movendo…
          </p>
        ) : null}
        {!canMove ? (
          <p className="mt-1 text-[11px] text-slate-500">Você não tem permissão para mudar a etapa.</p>
        ) : null}
        {erro ? <p className="mt-1 text-[11px] text-rose-300">{erro}</p> : null}

        {perdaPendente ? (
          <div className="mt-2 space-y-2 border-t border-slate-700 pt-2">
            <label className="block text-[11px] text-slate-400" htmlFor="conversa-motivo-perda">
              Por que perdeu? (fica no relatório)
            </label>
            <input
              id="conversa-motivo-perda"
              className="w-full rounded-lg border border-slate-700 bg-transparent px-2 py-1 text-sm text-slate-100 outline-none"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="Ex.: sem verba agora"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-full border border-rose-500/30 px-3 py-1 text-xs font-semibold text-rose-300"
                onClick={async () => {
                  const alvo = perdaPendente;
                  setPerdaPendente(null);
                  await mover(alvo, motivo.trim() || undefined);
                }}
              >
                Confirmar perda
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300"
                onClick={() => setPerdaPendente(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={CAIXA}>
        {/* Os MESMOS seletores do detalhe do negócio: etiquetas (com categoria, que é onde
            "tipo de serviço" vive) e origem do lead (anúncio, indicação, Instagram…). */}
        <DealTagSelector
          organizationId={organizationId}
          dealId={dealId}
          canAssign={canAssignTags}
          canManage={canManageTags}
        />
        <div className="mt-2 border-t border-slate-700 pt-2">
          <DealOriginSelector
            organizationId={organizationId}
            dealId={dealId}
            canAssign={canAssignOrigin}
          />
        </div>
      </div>
    </div>
  );
}
