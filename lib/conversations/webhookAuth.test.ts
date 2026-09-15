import { describe, it, expect } from 'vitest';
import { evaluateWebhookAuth, readWebhookSecretFromRequest } from './webhookAuth';

// Regressão do achado Critical 3 (auditoria Codex 2026-07-03):
// o webhook Evolution aceitava POST sem secret quando o payload.instance batia com
// o instanceName configurado — bypass de autenticação (grava conversa + dispara IA).
// O instanceName NÃO é secreto (vem do próprio payload). Fix: exigir secret válido SEMPRE;
// desde 15/09/2026 (parecer do Codex B1/G11) conexão sem secret também é recusada (a migration
// 20260915000000 preencheu o secret em toda conexão). Comparação de secret é timing-safe.

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

  it('REJEITA conexão SEM secret mesmo com instanceName batendo (fail-closed, parecer B1/G11 de 15/09)', () => {
    const r = evaluateWebhookAuth({ expectedSecret: '', requestSecret: '', ...matchingInstance });
    expect(r.authorized).toBe(false);
    expect(r.authMode).toBe('no_secret_configured');
  });

  it('REJEITA conexão SEM secret quando a request manda um secret qualquer', () => {
    const r = evaluateWebhookAuth({ expectedSecret: '', requestSecret: 'qualquer', ...matchingInstance });
    expect(r.authorized).toBe(false);
  });

  it('comparação timing-safe não estoura com comprimentos diferentes e rejeita', () => {
    expect(() =>
      evaluateWebhookAuth({ expectedSecret: 'abcdef', requestSecret: 'xy', ...matchingInstance })
    ).not.toThrow();
    const r = evaluateWebhookAuth({ expectedSecret: 'abcdef', requestSecret: 'xy', ...matchingInstance });
    expect(r.authorized).toBe(false);
  });
});

describe('readWebhookSecretFromRequest (segredo no cabeçalho, URL só como legado)', () => {
  const url = 'https://crm.example.com/api/public/channels/evolution/abc/webhook';

  it('lê o cabeçalho x-webhook-secret', () => {
    const req = new Request(url, { method: 'POST', headers: { 'x-webhook-secret': ' s3cr3t ' } });
    expect(readWebhookSecretFromRequest(req)).toBe('s3cr3t');
  });

  it('lê Authorization: Bearer', () => {
    const req = new Request(url, { method: 'POST', headers: { authorization: 'Bearer tok' } });
    expect(readWebhookSecretFromRequest(req)).toBe('tok');
  });

  it('ainda aceita ?secret= (registros antigos), mas o cabeçalho vence a URL', () => {
    expect(readWebhookSecretFromRequest(new Request(`${url}?secret=antigo`, { method: 'POST' }))).toBe('antigo');
    const both = new Request(`${url}?secret=antigo`, { method: 'POST', headers: { 'x-webhook-secret': 'novo' } });
    expect(readWebhookSecretFromRequest(both)).toBe('novo');
  });

  it('sem nada → vazio', () => {
    expect(readWebhookSecretFromRequest(new Request(url, { method: 'POST' }))).toBe('');
  });
});
