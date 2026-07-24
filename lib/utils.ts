import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Função pública `cn` do projeto.
 *
 * @param {ClassValue[]} inputs - Parâmetro `inputs`.
 * @returns {string} Retorna um valor do tipo `string`.
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

const brlFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

/**
 * Formata valores monetários em Real ("R$ 4.800").
 * Fonte única — nunca montar "$" na mão em componente.
 */
export function formatBRL(value: number | null | undefined): string {
    return brlFormatter.format(Number(value) || 0);
}
