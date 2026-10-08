/**
 * Identidade da conexão Google: a data de conexão e a conta. Reconectar sempre grava `connected_at` novo (função
 * `write_google_calendar_refresh_token`), então um token ou uma agenda guardados em memória de OUTRA conexão deixam de
 * valer em qualquer instância, sem depender de qual instância atendeu a reconexão (rodada 4 do Codex, fatia 3).
 */
export function versaoDaConexaoGoogle(conexao: { connectedAt: string | null; googleAccountEmail: string }): string {
  return `${conexao.connectedAt ?? ''}|${conexao.googleAccountEmail}`;
}
