import { describe, expect, it } from 'vitest';

import {
  redactChannelPayload,
  redactChannelSecrets,
} from './redactChannelSecrets';

describe('redactChannelSecrets', () => {
  it('redige valores literais, codificados e os nomes das credenciais', () => {
    const apiKey = 'API+/=KEY';
    const webhookSecret = 'WEBHOOK+/=SECRET';
    const message =
      `apiKey=${apiKey}; webhook_secret=${encodeURIComponent(webhookSecret)}`;

    const result = redactChannelSecrets(message, [apiKey, webhookSecret], 'Falha externa.');

    expect(result).toContain('[redigido]');
    expect(result).not.toContain(apiKey);
    expect(result).not.toContain(encodeURIComponent(webhookSecret));
    expect(result).not.toMatch(/apiKey|webhook[_ -]?secret/i);
  });

  it('preserva mensagem estruturada sem expor a credencial', () => {
    const result = redactChannelSecrets(
      { message: 'Provider recusou token-secreto' },
      ['token-secreto'],
      'Falha externa.',
    );

    expect(result).toBe('Provider recusou [redigido]');
  });

  it('redige valor rotulado mesmo quando o resolvedor falha antes de devolvê-lo', () => {
    const result = redactChannelSecrets(
      new Error('Falha ao resolver api-key=SEGREDO-NAO-CONHECIDO'),
      [],
      'Falha externa.',
    );

    expect(result).toBe('Falha ao resolver credencial=[redigido]');
    expect(result).not.toContain('SEGREDO-NAO-CONHECIDO');
  });

  it('redige valor de propriedade JSON entre aspas', () => {
    const result = redactChannelSecrets(
      '{"apiKey":"SEGREDO-JSON","status":"error"}',
      [],
      'Falha externa.',
    );

    expect(result).not.toContain('SEGREDO-JSON');
    expect(result).not.toMatch(/apiKey/i);
    expect(result).toContain('[redigido]');
  });

  it('remove propriedades secretas e redige strings em payload aninhado', () => {
    const apiKey = 'API-SECRET-NESTED';
    const payload = {
      status: 'ok',
      apiKey: 'SEGREDO-DESCONHECIDO',
      nested: {
        webhook_secret: 'OUTRO-SEGREDO',
        message: `provider ecoou ${apiKey}`,
      },
    };

    const result = redactChannelPayload(payload, [apiKey]);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      status: 'ok',
      nested: { message: 'provider ecoou [redigido]' },
    });
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toMatch(/apiKey|webhook_secret/i);
  });
});
