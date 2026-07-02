/**
 * N7 — CSV COMPLETO de atendimentos/pacientes (nível B: export dentro do CRM, com login).
 *
 * Contém PII (nome/telefone do paciente) — POR ISSO só é servido pela rota autenticada
 * (requireAdminTenantContext), NUNCA pelo link público. Recebe client ADMIN; quem chama
 * já validou que o caller é admin do targetOrganizationId.
 */
import { toCsv } from './csv';

export async function buildAtendimentosCsv(admin: any, organizationId: string): Promise<string> {
  const { data, error } = await admin
    .from('atendimentos')
    .select(
      'performed_at, procedimento, valor, desconto, payment_method, installments, recebido, paid_at,' +
        ' contacts(name, phone), professionals(name)'
    )
    .eq('organization_id', organizationId)
    .order('performed_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows: unknown[][] = [
    ['Data', 'Paciente', 'Telefone', 'Procedimento', 'Profissional', 'Valor', 'Desconto', 'Líquido', 'Pagamento', 'Parcelas', 'Recebido', 'Pago em'],
  ];
  for (const r of data || []) {
    const contact = (r.contacts || {}) as { name?: string; phone?: string };
    const prof = (r.professionals || {}) as { name?: string };
    const liq = Number(r.valor || 0) - Number(r.desconto || 0);
    rows.push([
      r.performed_at || '',
      contact.name || '',
      contact.phone || '',
      r.procedimento || '',
      prof.name || '',
      Number(r.valor || 0).toFixed(2),
      Number(r.desconto || 0).toFixed(2),
      liq.toFixed(2),
      r.payment_method || '',
      r.installments ?? '',
      r.recebido ? 'sim' : 'não',
      r.paid_at || '',
    ]);
  }
  return toCsv(rows);
}
