import { TenantAgentsPage } from '@/features/agents/TenantAgentsPage';

export default async function PlatformTenantAgentsRoute({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <TenantAgentsPage tenantId={tenantId} />;
}
