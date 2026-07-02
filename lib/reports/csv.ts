/**
 * Escape de campo CSV (RFC 4180): aspas duplas em volta se tiver vírgula, aspas ou quebra.
 * Usado pelos relatórios do N7 (planilhas conectadas + export de pacientes).
 */
export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Junta linhas (array de arrays) num CSV com \n final. */
export function toCsv(rows: unknown[][]): string {
  return rows.map((cols) => cols.map(csvEscape).join(',')).join('\n') + '\n';
}
