import { AgentEditorPage } from '@/features/agents/AgentEditorPage';

export default async function PlatformTenantAgentEditorRoute({
  params,
}: {
  params: Promise<{ tenantId: string; agentId: string }>;
}) {
  const { tenantId, agentId } = await params;
  // A chave remonta o editor ao trocar de cliente ou de agente: nenhum estado (texto, revisão, resposta atrasada) do
  // agente anterior sobrevive para ser enviado ao endereço novo (revisão do Codex, 07/10).
  return <AgentEditorPage key={`${tenantId}:${agentId}`} tenantId={tenantId} agentId={agentId} />;
}
