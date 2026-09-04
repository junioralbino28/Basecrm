/**
 * N7 — CSV de TOTAIS da organização (nível A: link automático Excel/Sheets).
 *
 * ⚠️ SEGURANÇA: SÓ AGREGADOS. NUNCA linha/PII de paciente. Este CSV vai atrás de um
 * token NA URL (=IMPORTDATA faz GET sem header) — se o link vazar, só vaza número.
 * A lista com PII fica no export autenticado (atendimentosCsv.ts), atrás de login.
 *
 * Recebe um client ADMIN (service-role): quem chama já validou o token → org.
 */
import { toCsv } from './csv';

export async function buildSummaryCsv(admin: any, organizationId: string): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Faturamento = (valor - desconto) de atendimentos RECEBIDOS.
  const { data: pagos, error: pagosErr } = await admin
    .from('atendimentos')
    .select('valor, desconto, paid_at')
    .eq('organization_id', organizationId)
    .eq('recebido', true);
  if (pagosErr) throw new Error(pagosErr.message);

  let fatTotal = 0;
  let fatMes = 0;
  for (const r of pagos || []) {
    const liq = Number(r.valor || 0) - Number(r.desconto || 0);
    fatTotal += liq;
    if (r.paid_at && r.paid_at >= monthStart) fatMes += liq;
  }

  // Leads (contagem, sem trazer linhas). Fonte = `contacts`: é onde o CRM grava
  // todo lead que entra. A tabela `leads` é LEGADA e está vazia — contar dela
  // mostraria "Leads: 0" pra sempre na planilha conectada.
  const { count: leadsTotal } = await admin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);
  const { count: leadsMes } = await admin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .gte('created_at', monthStart);

  // Agendamentos futuros (tolera tabela/coluna ausente → 0, sem quebrar o CSV).
  let agendFuturos = 0;
  const { count: agendCount, error: agendErr } = await admin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .gte('starts_at', now.toISOString());
  if (!agendErr) agendFuturos = agendCount || 0;

  // Comercial do mês pelo mês de FECHAMENTO (decisão de 04/09) — a mesma conta
  // canônica da tela (commercial_report_data), executada como service_role.
  // Tolera erro (função ausente/antiga) → sem as linhas, sem quebrar o CSV.
  const linhasComerciais: string[][] = [];
  const { data: comercial, error: comercialErr } = await admin.rpc('commercial_report_data', {
    p_organization_id: organizationId,
    p_start: monthStart,
    p_end: now.toISOString(),
  });
  if (!comercialErr && comercial) {
    const f = comercial.fechamento ?? {};
    linhasComerciais.push(
      ['Fechados no mês (qtd)', String(f.ganhos?.qtd ?? 0)],
      ['Fechados no mês (R$)', Number(f.ganhos?.valor ?? 0).toFixed(2)],
      ['Perdidos no mês (qtd)', String(f.perdidos?.qtd ?? 0)],
      ['Taxa de fechamento (%)', String(f.taxa_fechamento ?? 0)],
      ['Ticket médio (R$)', Number(f.ticket_medio ?? 0).toFixed(2)]
    );
    for (const o of (comercial.por_origem ?? []).slice(0, 5)) {
      linhasComerciais.push([
        `Fechados por origem — ${o.origem}`,
        `${o.ganhos_qtd ?? 0} / ${Number(o.ganhos_valor ?? 0).toFixed(2)}`,
      ]);
    }
  }

  return toCsv([
    ['Métrica', 'Valor'],
    ['Faturamento (mês)', fatMes.toFixed(2)],
    ['Faturamento (total)', fatTotal.toFixed(2)],
    ['Leads (mês)', String(leadsMes ?? 0)],
    ['Leads (total)', String(leadsTotal ?? 0)],
    ['Agendamentos futuros', String(agendFuturos)],
    ...linhasComerciais,
    ['Atualizado em', now.toISOString()],
  ]);
}
