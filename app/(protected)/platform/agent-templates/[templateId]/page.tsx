import { EditorDoModelo } from '@/features/agents/EditorDoModelo';

export default async function PlatformAgentTemplateRoute({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  return <EditorDoModelo templateId={templateId} />;
}
