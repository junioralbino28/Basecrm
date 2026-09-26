/**
 * Texto do feedback do compositor depois de um envio manual.
 *
 * Falha e incerteza sao estados DIFERENTES e pedem acoes diferentes do operador:
 * - `failed`: a mensagem NAO chegou — tentar de novo e seguro;
 * - `unknown`/`pending`: PODE ter chegado — reenviar as cegas e o que duplica mensagem para o
 *   lead. O texto manda conferir na conversa antes de qualquer nova tentativa.
 */

export type FeedbackDoEnvio = { kind: 'success' | 'warning'; text: string };

export function feedbackDoEnvio(params: {
  oQue: 'mensagem' | 'anexo' | 'nota';
  deliveryStatus: string | null | undefined;
  warning: string | null | undefined;
  replayed?: boolean;
}): FeedbackDoEnvio {
  const { oQue, deliveryStatus, warning, replayed } = params;

  if (oQue === 'nota') {
    return { kind: 'success', text: 'Nota interna registrada.' };
  }

  const rotulo = oQue === 'anexo' ? 'O anexo' : 'A mensagem';

  if (deliveryStatus === 'failed') {
    return {
      kind: 'warning',
      text: `${rotulo} não chegou ao WhatsApp${warning ? `: ${warning}` : '.'} Você pode tentar de novo.`,
    };
  }

  if (deliveryStatus === 'unknown' || deliveryStatus === 'pending') {
    return {
      kind: 'warning',
      text: `Sem confirmação da Evolution${warning ? ` (${warning})` : ''}. Antes de reenviar, confira na conversa se ${oQue === 'anexo' ? 'o anexo' : 'a mensagem'} chegou — reenviar às cegas pode duplicar para o lead.`,
    };
  }

  if (replayed) {
    return {
      kind: 'success',
      text: `Ess${oQue === 'anexo' ? 'e anexo' : 'a mensagem'} já tinha sido enviad${oQue === 'anexo' ? 'o' : 'a'} — nada foi reenviado.`,
    };
  }

  return {
    kind: 'success',
    text: oQue === 'anexo' ? 'Anexo enviado.' : 'Mensagem enviada e registrada na conversa humana.',
  };
}
