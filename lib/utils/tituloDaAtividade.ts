/**
 * Título de uma atividade como aparece na tela e no contexto mandado à IA.
 *
 * O banco guarda títulos da época em que o CRM só atendia clínica ('Paciente Criado'). O dado gravado não muda; só
 * o texto mostrado vira o termo neutro do CRM multi-nicho (limpeza de vocabulário de 07/10/2026, revisão do Codex).
 * Todo lugar que mostra `activity.title` passa por aqui; test/vocabularioCliente.test.ts trava isso.
 */
const TITULOS_HISTORICOS: Readonly<Record<string, string>> = {
  'Paciente Criado': 'Lead criado',
};

export function tituloDaAtividade(titulo: string): string {
  return Object.prototype.hasOwnProperty.call(TITULOS_HISTORICOS, titulo) ? TITULOS_HISTORICOS[titulo] : titulo;
}
