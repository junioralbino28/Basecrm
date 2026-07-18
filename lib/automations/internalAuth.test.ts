import { describe, expect, it } from 'vitest';
import { authorizeAutomationInternalRequest } from './internalAuth';

describe('authorizeAutomationInternalRequest', () => {
  it('falha fechado quando o segredo esperado está ausente', () => {
    const request = new Request('http://localhost/api/internal/automations/tick', {
      headers: { authorization: 'Bearer qualquer' },
    });

    expect(authorizeAutomationInternalRequest(request, undefined)).toBe(false);
    expect(authorizeAutomationInternalRequest(request, '')).toBe(false);
  });

  it('aceita somente Bearer com correspondência exata', () => {
    const secret = 'segredo-local-f4';
    const authorized = new Request('http://localhost/api/internal/automations/tick', {
      headers: { authorization: `Bearer ${secret}` },
    });
    const wrong = new Request('http://localhost/api/internal/automations/tick', {
      headers: { authorization: 'Bearer segredo-incorreto' },
    });

    expect(authorizeAutomationInternalRequest(authorized, secret)).toBe(true);
    expect(authorizeAutomationInternalRequest(wrong, secret)).toBe(false);
  });
});
