// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';

const routePath = resolve(
  process.cwd(),
  'app/api/public/channels/evolution/[connectionId]/webhook/route.ts'
);

/**
 * 🐛 Regressão do bug real de 28/07/2026: mensagem chegava, o contador de
 * não-vistas ia a 1 e MORRIA em milissegundos — um segundo update (do debounce
 * da IA) reconstruía a metadata a partir da foto lida ANTES do incremento e
 * gravava o zero por cima. Nenhuma conversa `ai_active` acumulava não-lidas;
 * o número do menu e a notificação nunca apareciam. Achado ao vivo pelo Junior
 * ("não apareceu nada aqui no CRM").
 */
describe('webhook Evolution — o não-lido sobrevive ao caminho da IA', () => {
  it('a dinâmica do bug: rebuild sobre foto VELHA esmaga o incremento', () => {
    const fotoAntesDaMensagem = { unreadCount: 0 };

    // 1º update (correto): inbound soma 1.
    const aposIncremento = buildConversationThreadMetadataUpdate(fotoAntesDaMensagem, {
      direction: 'inbound',
      incrementUnread: true,
    });
    expect(aposIncremento.unreadCount).toBe(1);

    // O update REMOVIDO fazia isto: rebuild a partir da foto velha, sem somar.
    const oQueOBugGravava = buildConversationThreadMetadataUpdate(fotoAntesDaMensagem, {
      direction: 'inbound',
      incrementUnread: false,
    });
    expect(oQueOBugGravava.unreadCount).toBe(0); // ← era isto que ia pro banco

    // O caminho certo: partir da foto FRESCA preserva o contador.
    const partindoDaFotoFresca = buildConversationThreadMetadataUpdate(aposIncremento, {
      direction: 'inbound',
      incrementUnread: false,
    });
    expect(partindoDaFotoFresca.unreadCount).toBe(1);
  });

  it('o update esmagador não existe mais no fonte do webhook', () => {
    const source = readFileSync(routePath, 'utf-8');

    // O bloco removido era o ÚNICO rebuild de metadata dentro do ramo ai_active
    // a partir de `threadResult.data?.metadata` com incrementUnread: false.
    expect(source).not.toContain('pendingMetadataUpdate');
    expect(source).not.toContain('incrementUnread: false,');

    // O marcador do debounce continua partindo de leitura fresca (spread),
    // que preserva o unreadCount em vez de recalculá-lo de foto velha.
    expect(source).toContain('...currentThreadMetadata');
    expect(source).toContain('aiPendingToken: aiPendingToken');
  });
});
