// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('tenant realtime and AI guardrails', () => {
  const realtimeSource = readFileSync(resolve(process.cwd(), 'lib/realtime/useRealtimeSync.ts'), 'utf-8');
  const aiToolsSource = readFileSync(resolve(process.cwd(), 'lib/ai/tools.ts'), 'utf-8');

  it('scopes realtime subscriptions by organization_id', () => {
    expect(realtimeSource).toContain("filter: `organization_id=eq.${organizationId}`");
    expect(realtimeSource).toContain('payloadOrganizationId');
  });

  it('removes null-organization compatibility from AI tools queries', () => {
    expect(aiToolsSource).not.toContain('organization_id.is.null');
    expect(aiToolsSource).toContain(".eq('organization_id', organizationId)");
  });
});
