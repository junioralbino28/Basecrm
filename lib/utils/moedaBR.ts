/**
 * @fileoverview Digitação de dinheiro no jeito brasileiro.
 *
 * Pedido do Junior (2026-07-27):
 *   - decimal com **vírgula**, não ponto;
 *   - os dois decimais já contam sozinhos enquanto se digita;
 *   - não precisar apagar o zero que já está no campo.
 *
 * O comportamento é o do caixa: só os DÍGITOS contam e entram pela direita.
 * Campo em "0,00", digita 1 → "0,01"; digita 5 → "0,15"; digita 0 → "1,50".
 * Apagar tira o último dígito, e o zero da frente some sozinho — ninguém
 * precisa selecionar o conteúdo antes de escrever.
 */

/** Só os dígitos, do jeito que a pessoa digitou. */
function apenasDigitos(texto: string): string {
  return (texto || '').replace(/\D/g, '');
}

/**
 * Texto digitado → texto formatado (`1.234,56`).
 *
 * Recebe o VALOR INTEIRO do campo (não só a tecla): serve tanto pra digitação
 * quanto pra colar. Campo vazio devolve vazio — assim o `placeholder` aparece
 * em vez de um "0,00" que a pessoa teria que apagar.
 */
export function mascararMoedaBR(digitado: string): string {
  const digitos = apenasDigitos(digitado).replace(/^0+(?=\d)/, '');
  if (!digitos) return '';
  const centavos = digitos.padStart(3, '0');
  const inteiros = centavos.slice(0, -2);
  const decimais = centavos.slice(-2);
  const comMilhar = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${comMilhar},${decimais}`;
}

/**
 * Texto brasileiro → número. `1.234,56` → 1234.56.
 *
 * Aceita também o formato com ponto decimal (`1234.56`) porque valor vindo do
 * banco ou de importação chega assim — devolver NaN aí apagaria dado bom.
 */
export function paraNumeroBR(texto: string | number | null | undefined): number {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : 0;
  const bruto = (texto || '').toString().trim();
  if (!bruto) return 0;

  const temVirgula = bruto.includes(',');
  const normalizado = temVirgula
    // Vírgula é o decimal: o ponto que sobrar é separador de milhar.
    ? bruto.replace(/\./g, '').replace(',', '.')
    : bruto;

  const n = Number(normalizado.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Número → texto do campo (`1234.5` → `1.234,50`). Zero vira campo vazio. */
export function paraCampoMoedaBR(valor: number | null | undefined): string {
  if (!valor) return '';
  return mascararMoedaBR(Math.round(Math.abs(valor) * 100).toString());
}
