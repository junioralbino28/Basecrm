/**
 * Tradutor de erros do motor pra linguagem leiga (regra do produto, pedido do
 * Junior em 2026-07-24: "precisa ser uma explicação em linguagem leiga — se
 * aplica a qualquer erro ou instrução").
 *
 * As mensagens nascem no compilador (`lib/automations/compiler.ts`, domínio do
 * motor) no dialeto técnico ("config inválida em switch: cases.0.value operador
 * contains exige value"). A UI traduz ANTES de exibir; o texto original vai
 * junto entre parênteses pra facilitar o suporte.
 */

const STEP_NAMES: Record<string, string> = {
  send_message: 'Envia · WhatsApp',
  delay: 'Espera',
  wait_for_event: 'Aguardar resposta',
  create_task: 'Criar tarefa',
  switch: 'Dividir caminho',
  condition: 'Condição',
};

export function toFriendlyAutomationError(raw: string): string {
  const switchValueIssue = raw.match(
    /config inválida em switch: cases\.(\d+)\.value operador \S+ exige value/i,
  );
  if (switchValueIssue) {
    const position = Number(switchValueIssue[1]) + 1;
    return (
      `O passo "Dividir caminho" tem um caminho sem valor de comparação `
      + `(caminho nº ${position}). Abra o passo no mapa e preencha o que o sistema `
      + `deve procurar nesse caminho — ou exclua o caminho. (detalhe técnico: ${raw})`
    );
  }

  const uuidIssue = raw.match(/config inválida em switch: (\S+) exige value UUID/i);
  if (uuidIssue) {
    return (
      `O passo "Dividir caminho" compara "${uuidIssue[1]}", que precisa de um item `
      + `selecionado da lista (não texto digitado). Abra o passo e escolha o valor. `
      + `(detalhe técnico: ${raw})`
    );
  }

  const invalidStep = raw.match(/config inválida em (\w+): (.+)/i);
  if (invalidStep) {
    const stepName = STEP_NAMES[invalidStep[1]] ?? invalidStep[1];
    return (
      `O passo "${stepName}" está incompleto e o rascunho não pôde ser salvo. `
      + `Abra o passo no mapa e complete o que falta. (detalhe técnico: ${raw})`
    );
  }

  return raw;
}
