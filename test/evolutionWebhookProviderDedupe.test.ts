// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routePath = resolve(
  process.cwd(),
  'app/api/public/channels/evolution/[connectionId]/webhook/route.ts'
);

describe('webhook Evolution — dedupe atômico por provider ID', () => {
  const source = readFileSync(routePath, 'utf-8');

  it('consulta e grava colunas próprias em vez de caminho JSONB', () => {
    expect(source).toContain(".eq('provider_message_id', parsed.providerMessageId)");
    expect(source).toContain('provider_message_id: parsed.providerMessageId');
    expect(source).toContain('channel_connection_id: connectionId');
    expect(source).not.toContain(".eq('metadata->>provider_message_id'");
  });

  it('trata a corrida pelo 23505 da constraint única', () => {
    expect(source).toContain("insertedMessage.error.code === '23505'");
    expect(source).toContain('duplicate: true');
  });

  it('entrega inbox inbound ao wait_for_event com quote e também no replay deduplicado', () => {
    expect(source).toContain("rpc('resolve_automation_wait_from_inbox'");
    expect(source).toContain('p_quoted_provider_message_id: parsed.quotedProviderMessageId');
    expect(source.match(/resolve_automation_wait_from_inbox/g)).toHaveLength(2);
  });
});
