'use client';

/**
 * Notificações de mensagem recebida (pedido do Junior, 28/07/2026):
 * "chega a mensagem, mas não notifica em lugar nenhum no CRM" — número de
 * não-vistas no menu lateral, janela de notificação estilo WhatsApp com som,
 * e o usuário podendo ligar/desligar a notificação e o som.
 *
 * Desenho: o servidor JÁ conta não-lidas por conversa (`unread_count`, zerado
 * quando a conversa é aberta). Aqui só se pergunta a cada 30s e reage:
 * - o menu lateral usa `useConversasNaoLidas` pra pintar a bolinha;
 * - `NotificacoesDeConversa` (sem UI) compara com a foto anterior e dispara a
 *   notificação do sistema + som SÓ pra conversa que GANHOU mensagem — nunca
 *   pro estoque antigo de não-lidas ao abrir a página.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

export type PreferenciasNotificacao = {
  /** Janela de notificação do sistema ligada? */
  ativas: boolean;
  /** Toca o som junto? */
  som: boolean;
};

const PREFERENCIAS_PADRAO: PreferenciasNotificacao = { ativas: true, som: true };
const EVENTO_PREFERENCIAS = 'basecrm:notificacoes-conversa';

function chave(userId: string | null | undefined) {
  return `basecrm.notificacoes.conversas.${userId || 'anon'}`;
}

export function lerPreferencias(userId: string | null | undefined): PreferenciasNotificacao {
  if (typeof window === 'undefined') return PREFERENCIAS_PADRAO;
  try {
    const bruto = window.localStorage.getItem(chave(userId));
    if (!bruto) return PREFERENCIAS_PADRAO;
    const lido = JSON.parse(bruto) as Partial<PreferenciasNotificacao>;
    return {
      ativas: typeof lido.ativas === 'boolean' ? lido.ativas : PREFERENCIAS_PADRAO.ativas,
      som: typeof lido.som === 'boolean' ? lido.som : PREFERENCIAS_PADRAO.som,
    };
  } catch {
    return PREFERENCIAS_PADRAO;
  }
}

export function salvarPreferencias(userId: string | null | undefined, prefs: PreferenciasNotificacao) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chave(userId), JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(EVENTO_PREFERENCIAS));
  } catch {
    // sem localStorage (modo restrito) a preferência só não persiste
  }
}

/** Assina mudanças das preferências (mesma aba, via evento). */
export function usePreferenciasNotificacao(userId: string | null | undefined) {
  const [prefs, setPrefs] = React.useState<PreferenciasNotificacao>(() => lerPreferencias(userId));

  React.useEffect(() => {
    setPrefs(lerPreferencias(userId));
    const atualizar = () => setPrefs(lerPreferencias(userId));
    window.addEventListener(EVENTO_PREFERENCIAS, atualizar);
    return () => window.removeEventListener(EVENTO_PREFERENCIAS, atualizar);
  }, [userId]);

  return prefs;
}

export type ConversaNaoLida = {
  id: string;
  nome: string;
  previa: string;
  horario: string | null;
  naoLidas: number;
};

export type ResumoNaoLidas = {
  /** Conversas com pelo menos 1 mensagem não vista (o número da bolinha). */
  conversas: ConversaNaoLida[];
  totalConversas: number;
  totalMensagens: number;
  /** Hora da mensagem não vista mais recente (pro tooltip do menu). */
  ultimaHora: string | null;
};

type ThreadDaApi = {
  id: string;
  title?: string | null;
  contact_name?: string | null;
  contact?: { name?: string | null } | null;
  unread_count?: number;
  last_message_preview?: string | null;
  last_message_sent_at?: string | null;
  last_message_at?: string | null;
};

export function resumirNaoLidas(threads: ThreadDaApi[]): ResumoNaoLidas {
  const conversas = threads
    .filter((thread) => (thread.unread_count ?? 0) > 0)
    .map((thread) => ({
      id: thread.id,
      nome: thread.contact_name || thread.contact?.name || thread.title || 'Contato sem nome',
      previa: thread.last_message_preview || 'Nova mensagem',
      horario: thread.last_message_sent_at || thread.last_message_at || null,
      naoLidas: thread.unread_count ?? 0,
    }));

  const ultimaHora = conversas
    .map((c) => c.horario)
    .filter((h): h is string => Boolean(h))
    .sort()
    .at(-1) ?? null;

  return {
    conversas,
    totalConversas: conversas.length,
    totalMensagens: conversas.reduce((soma, c) => soma + c.naoLidas, 0),
    ultimaHora,
  };
}

/**
 * Quais conversas GANHARAM mensagem desde a última foto? Só essas notificam —
 * o estoque antigo de não-lidas não deve apitar de novo a cada recarregada.
 * `antes === null` significa "primeira foto": nada notifica.
 */
export function conversasQueGanharamMensagem(
  antes: Map<string, number> | null,
  resumo: ResumoNaoLidas,
): ConversaNaoLida[] {
  if (!antes) return [];
  return resumo.conversas.filter((c) => c.naoLidas > (antes.get(c.id) ?? 0));
}

export function formatarHoraBR(iso: string | null): string {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Consulta compartilhada (menu e vigia usam a MESMA — o cache deduplica). */
export function useConversasNaoLidas(tenantId: string | null, habilitado: boolean) {
  return useQuery({
    queryKey: ['conversas-nao-lidas', tenantId],
    enabled: habilitado && Boolean(tenantId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 25_000,
    queryFn: async (): Promise<ResumoNaoLidas> => {
      const res = await fetch(`/api/platform/tenants/${tenantId}/conversations`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Falha ao conferir mensagens (HTTP ${res.status})`);
      const threads = (data?.threads ?? []) as ThreadDaApi[];
      return resumirNaoLidas(threads);
    },
  });
}

/** Som curto de duas notas, gerado na hora — sem arquivo de áudio. */
function tocarSom() {
  try {
    type JanelaComAudio = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctx = window.AudioContext || (window as JanelaComAudio).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const agora = ctx.currentTime;
    [880, 1174.66].forEach((frequencia, i) => {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequencia;
      const inicio = agora + i * 0.12;
      ganho.gain.setValueAtTime(0.0001, inicio);
      ganho.gain.exponentialRampToValueAtTime(0.12, inicio + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.25);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.3);
    });
    window.setTimeout(() => { void ctx.close(); }, 800);
  } catch {
    // áudio bloqueado pelo navegador: a notificação visual continua valendo
  }
}

/**
 * Vigia sem UI: montado uma vez no Layout. Dispara a notificação do sistema
 * (estilo WhatsApp) + som quando alguma conversa ganha mensagem nova.
 */
export function NotificacoesDeConversa({
  tenantId,
  userId,
  habilitado,
}: {
  tenantId: string | null;
  userId: string | null | undefined;
  habilitado: boolean;
}) {
  const router = useRouter();
  const prefs = usePreferenciasNotificacao(userId);
  const { data } = useConversasNaoLidas(tenantId, habilitado);
  const fotoAnterior = React.useRef<Map<string, number> | null>(null);

  React.useEffect(() => {
    if (!data) return;

    const novas = conversasQueGanharamMensagem(fotoAnterior.current, data);
    fotoAnterior.current = new Map(data.conversas.map((c) => [c.id, c.naoLidas]));
    if (!novas.length || !prefs.ativas) return;

    const podeNotificar = typeof window !== 'undefined'
      && 'Notification' in window
      && Notification.permission === 'granted';

    if (podeNotificar) {
      for (const conversa of novas) {
        try {
          const noti = new Notification(conversa.nome, {
            body: `${conversa.previa}${conversa.horario ? ` · ${formatarHoraBR(conversa.horario)}` : ''}`,
            tag: `basecrm-conversa-${conversa.id}`, // substitui a anterior da MESMA conversa
            icon: '/favicon.ico',
          });
          noti.onclick = () => {
            window.focus();
            if (tenantId) router.push(`/platform/tenants/${tenantId}/conversations`);
            noti.close();
          };
        } catch {
          // alguns navegadores móveis não deixam construir Notification direto
        }
      }
    }

    if (prefs.som) tocarSom();
  }, [data, prefs.ativas, prefs.som, router, tenantId]);

  return null;
}

/** Pede a permissão do navegador na hora em que a pessoa LIGA a chave. */
export async function pedirPermissaoDeNotificacao(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
