import { describe, it, expect } from 'vitest';
import { evaluateWebhookAuth } from './webhookAuth';

// Regressão do achado Critical 3 (auditoria Codex 2026-07-03):
// o webhook Evolution aceitava POST sem secret quando o payload.instance batia com
// o instanceName configurado — bypass de autenticação (grava conversa + dispara IA).
// O instanceName NÃO é secreto (vem do próprio payload). Fix: se há webhookSecret
// configurado, exigir secret válido; fallback por instanceName só vale para conexões
// legadas SEM secret. Comparação de secret deve ser timing-safe.

const matchingInstance = {
  configuredInstanceName: 'minha-instancia',
  payloadInstanceName: 'minha-instancia',
};

describe('evaluateWebhookAuth', () => {
  it('REJEITA POST sem secret quando há webhookSecret, mesmo com instanceName batendo', () => {
    const r = evaluateWebhookAuth({ expectedSecret: 's3cr3t', requestSecret: '', ...matchingInstance });
    expect(r.authorized).toBe(false);
  });

  it('REJEITA secret errado', () => {
    const r = evaluateWebhookAuth({ expectedSecret: 's3cr3t', requestSecret: 'errado', ...matchingInstance });
    expect(r.authorized).toBe(false);
  });

  it('ACEITA secret correto (authMode=secret)', () => {
    const r = evaluateWebhookAuth({ expectedSecret: 's3cr3t', requestSecret: 's3cr3t', ...matchingInstance });
    expect(r.authorized).toBe(true);
    expect(r.authMode).toBe('secret');
  });

  it('ACEITA conexão legada SEM secret quando instanceName bate (fallback preservado)', () => {
    const r = evaluateWebhookAuth({ expectedSecret: '', requestSecret: '', ...matchingInstance });
    expect(r.authorized).toBe(true);
    expect(r.authMode).toBe('instance_fallback');
  });

  it('sem secret configurado e instanceName diferente → ainda aceita (legado), authMode=no_secret_configured', () => {
    const r = evaluateWebhookAuth({
      expectedSecret: '',
      requestSecret: '',
      configuredInstanceName: 'a',
      payloadInstanceName: 'b',
    });
    expect(r.authorized).toBe(true);
    expect(r.authMode).toBe('no_secret_configured');
  });

  it('comparação timing-safe não estoura com comprimentos diferentes e rejeita', () => {
    expect(() =>
      evaluateWebhookAuth({ expectedSecret: 'abcdef', requestSecret: 'xy', ...matchingInstance })
    ).not.toThrow();
    const r = evaluateWebhookAuth({ expectedSecret: 'abcdef', requestSecret: 'xy', ...matchingInstance });
    expect(r.authorized).toBe(false);
  });
});
