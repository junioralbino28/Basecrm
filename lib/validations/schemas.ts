/**
 * Zod validation schemas for FlowCRM forms
 *
 * Features:
 * - Standardized error codes for i18n
 * - Reusable field validators
 * - Type inference
 * - T033: Max length limits for security
 */
import { z } from 'zod';
import { ERROR_CODES, getErrorMessage } from './errorCodes';
import { isE164, normalizePhoneE164 } from '@/lib/phone';

// ============ MAX LENGTH CONSTANTS (T033) ============

const MAX_LENGTHS = {
  NAME: 200,
  EMAIL: 254, // RFC 5321
  PHONE: 30,
  TITLE: 200,
  COMPANY_NAME: 200,
  DESCRIPTION: 5000,
  NOTES: 10000,
  URL: 2000,
  SHORT_TEXT: 100,
  MEDIUM_TEXT: 500,
} as const;

// ============ HELPER FOR ERROR MESSAGES ============

const msg = (code: keyof typeof ERROR_CODES, params?: Record<string, string | number>) =>
  getErrorMessage(ERROR_CODES[code], params);

// ============ COMMON FIELD SCHEMAS ============

export const emailSchema = z
  .string({ message: msg('EMAIL_REQUIRED') })
  .min(1, msg('EMAIL_REQUIRED'))
  .max(MAX_LENGTHS.EMAIL, `Email deve ter no máximo ${MAX_LENGTHS.EMAIL} caracteres`)
  .email(msg('EMAIL_INVALID'));

export const phoneSchema = z
  .string()
  .optional()
  .transform(val => val || '')
  .pipe(
    z.string()
      .max(MAX_LENGTHS.PHONE, `Telefone deve ter no máximo ${MAX_LENGTHS.PHONE} caracteres`)
      .refine(val => val === '' || /^[\d\s\-\(\)\+]+$/.test(val), msg('PHONE_INVALID'))
  )
  .transform(val => normalizePhoneE164(val))
  .refine(val => val === '' || isE164(val), msg('PHONE_INVALID'));

/**
 * Função pública `requiredString` do projeto.
 *
 * @param {string} field - Parâmetro `field`.
 * @param {number} maxLength - Parâmetro `maxLength`.
 * @returns {ZodString} Retorna um valor do tipo `ZodString`.
 */
export const requiredString = (field: string, maxLength: number = MAX_LENGTHS.NAME) =>
  z.string({ message: msg('FIELD_REQUIRED', { field }) })
    .min(1, msg('FIELD_REQUIRED', { field }))
    .max(maxLength, `${field} deve ter no máximo ${maxLength} caracteres`);

export const optionalString = z
  .string()
  .max(MAX_LENGTHS.MEDIUM_TEXT, `Texto deve ter no máximo ${MAX_LENGTHS.MEDIUM_TEXT} caracteres`)
  .optional()
  .transform(val => val || '');

export const optionalLongString = z
  .string()
  .max(MAX_LENGTHS.DESCRIPTION, `Texto deve ter no máximo ${MAX_LENGTHS.DESCRIPTION} caracteres`)
  .optional()
  .transform(val => val || '');

export const currencySchema = z.coerce
  .number({ message: msg('NUMBER_REQUIRED', { field: 'Valor' }) })
  .min(0, msg('NUMBER_MUST_BE_POSITIVE', { field: 'Valor' }))
  .max(999999999999, 'Valor máximo excedido') // Max ~1 trillion
  .optional()
  .transform(val => val ?? 0);

/**
 * Função pública `requiredSelect` do projeto.
 *
 * @param {string} field - Parâmetro `field`.
 * @returns {ZodString} Retorna um valor do tipo `ZodString`.
 */
export const requiredSelect = (field: string) =>
  z
    .string({ message: msg('SELECTION_REQUIRED', { field }) })
    .min(1, msg('SELECTION_REQUIRED', { field }))
    .max(100, 'Seleção inválida');

/**
 * Função pública `requiredDate` do projeto.
 *
 * @param {string} field - Parâmetro `field`.
 * @returns {ZodString} Retorna um valor do tipo `ZodString`.
 */
export const requiredDate = (field: string) =>
  z.string({ message: msg('DATE_REQUIRED', { field }) })
    .min(1, msg('DATE_REQUIRED', { field }))
    .max(30, 'Data inválida');

// ============ CONTACT SCHEMAS ============

export const contactFormSchema = z.object({
  name: requiredString('Nome', MAX_LENGTHS.NAME),
  email: emailSchema,
  phone: phoneSchema,
  role: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  companyName: optionalString.pipe(z.string().max(MAX_LENGTHS.COMPANY_NAME)),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

// ============ COMPANY SCHEMAS ============

export const companyFormSchema = z.object({
  name: requiredString('Nome da Empresa', MAX_LENGTHS.COMPANY_NAME),
  industry: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  website: z
    .string()
    .max(MAX_LENGTHS.URL, `Website deve ter no máximo ${MAX_LENGTHS.URL} caracteres`)
    .optional()
    .or(z.literal(''))
    .transform(val => (val || '').trim())
    .transform(val => val.replace(/^https?:\/\//i, '').replace(/\/+$/g, ''))
    .refine(
      val => val === '' || /^[a-z0-9.-]+\.[a-z]{2,}.*$/i.test(val),
      'Website inválido'
    ),
});

export type CompanyFormData = z.infer<typeof companyFormSchema>;

// ============ DEAL SCHEMAS ============

export const dealFormSchema = z.object({
  title: requiredString('Nome do negócio', MAX_LENGTHS.TITLE),
  companyName: requiredString('Empresa', MAX_LENGTHS.COMPANY_NAME),
  value: currencySchema,
  contactName: optionalString.pipe(z.string().max(MAX_LENGTHS.NAME)),
  email: z.string()
    .max(MAX_LENGTHS.EMAIL, `Email deve ter no máximo ${MAX_LENGTHS.EMAIL} caracteres`)
    .email(msg('EMAIL_INVALID'))
    .optional()
    .or(z.literal('')),
  phone: phoneSchema,
});

export type DealFormData = z.infer<typeof dealFormSchema>;

// ============ ACTIVITY SCHEMAS ============

export const activityTypeSchema = z.enum([
  'CALL',
  'MEETING',
  'EMAIL',
  'TASK',
  'NOTE',
  'STATUS_CHANGE',
]);

export const activityFormTypeSchema = z.enum(['CALL', 'MEETING', 'EMAIL', 'TASK'], {
  message: msg('SELECTION_INVALID'),
});

export const activityFormSchema = z.object({
  title: requiredString('Título', MAX_LENGTHS.TITLE),
  type: activityFormTypeSchema,
  date: requiredDate('Data'),
  time: requiredString('Hora', 10),
  description: z.string().max(MAX_LENGTHS.DESCRIPTION).default(''),
  dealId: requiredSelect('Negócio'),
});

export type ActivityFormData = z.infer<typeof activityFormSchema>;

// ============ ATENDIMENTO SCHEMAS ============

export const atendimentoFormSchema = z
  .object({
    procedimento: requiredString('Procedimento', MAX_LENGTHS.TITLE),
    productId: requiredSelect('Procedimento'),
    valor: currencySchema,
    /** Desconto da planilha do Adel (total a receber = valor − desconto). */
    desconto: currencySchema,
    professionalId: requiredSelect('Profissional'),
    paymentMethod: requiredSelect('Forma de pagamento'),
    cardBrand: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
    installments: z.coerce.number().int().min(1).max(48).default(1),
    recebido: z.boolean().default(false),
  })
  // Invariante do faturamento: total a receber (valor − desconto) nunca negativo.
  .refine(data => data.desconto <= data.valor, {
    message: 'Desconto não pode ser maior que o valor do atendimento',
    path: ['desconto'],
  });

export type AtendimentoFormData = z.infer<typeof atendimentoFormSchema>;

// ============ BOARD SCHEMAS ============

export const boardFormSchema = z.object({
  name: requiredString('Nome do board', MAX_LENGTHS.NAME),
  description: optionalLongString,
});

export type BoardFormData = z.infer<typeof boardFormSchema>;

// ============ SETTINGS SCHEMAS ============

export const lifecycleStageSchema = z.object({
  name: requiredString('Nome do estágio', MAX_LENGTHS.SHORT_TEXT),
  color: requiredString('Cor', 20),
});

export type LifecycleStageFormData = z.infer<typeof lifecycleStageSchema>;

// ============ PROFESSIONALS SCHEMAS ============

export const professionalFormSchema = z.object({
  name: requiredString('Nome do profissional', MAX_LENGTHS.NAME),
  specialty: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  active: z.boolean().default(true),
});

export type ProfessionalFormData = z.infer<typeof professionalFormSchema>;

// ============ LEAD SOURCES SCHEMAS (N1 — origens editáveis) ============

export const leadSourceFormSchema = z.object({
  name: requiredString('Nome da origem', MAX_LENGTHS.SHORT_TEXT),
  active: z.boolean().default(true),
});

export type LeadSourceFormData = z.infer<typeof leadSourceFormSchema>;

// ============ FINANCE CONFIG SCHEMAS (gate do Adel — só admin) ============

/**
 * Percentual de domínio financeiro (taxa de cartão, comissão): 0..100.
 * Espelha os CHECKs do banco (20260616000000_finance_config.sql) — o zod
 * barra ANTES do insert, o banco é a última linha de defesa.
 */
export const percentSchema = z.coerce
  .number({ message: msg('NUMBER_REQUIRED', { field: 'Percentual' }) })
  .min(0, msg('NUMBER_MUST_BE_POSITIVE', { field: 'Percentual' }))
  .max(100, 'Percentual não pode passar de 100%');

export const paymentTypeSchema = z.enum(['credito', 'debito', 'pix', 'dinheiro'], {
  message: msg('SELECTION_INVALID'),
});

export const paymentMethodFeeFormSchema = z.object({
  label: requiredString('Descrição', MAX_LENGTHS.SHORT_TEXT),
  paymentType: paymentTypeSchema,
  cardBrand: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  installments: z.coerce
    .number({ message: msg('NUMBER_REQUIRED', { field: 'Parcelas' }) })
    .int('Parcelas inválidas')
    .min(1, 'Mínimo de 1 parcela')
    .max(48, 'Máximo de 48 parcelas')
    .default(1),
  feePercent: percentSchema,
});

export type PaymentMethodFeeFormData = z.infer<typeof paymentMethodFeeFormSchema>;

export const commissionRuleFormSchema = z.object({
  professionalId: requiredSelect('Profissional'),
  specialty: optionalString.pipe(z.string().max(MAX_LENGTHS.SHORT_TEXT)),
  percent: percentSchema,
});

export type CommissionRuleFormData = z.infer<typeof commissionRuleFormSchema>;

export const fixedCostFormSchema = z.object({
  name: requiredString('Nome da conta', MAX_LENGTHS.NAME),
  amount: currencySchema,
  dueDay: z.coerce
    .number()
    .int('Dia inválido')
    .min(1, 'Dia entre 1 e 31')
    .max(31, 'Dia entre 1 e 31')
    .optional(),
});

export type FixedCostFormData = z.infer<typeof fixedCostFormSchema>;

// ============ AI CONFIG SCHEMAS ============

export const aiConfigSchema = z.object({
  provider: z.enum(['gemini', 'openai', 'anthropic'], {
    message: msg('SELECTION_INVALID'),
  }),
  apiKey: z.string().max(200, 'API Key inválida').optional(),
  model: z.string().max(100, 'Modelo inválido').optional(),
});

export type AIConfigFormData = z.infer<typeof aiConfigSchema>;

// Export max lengths for use in forms
export { MAX_LENGTHS };

// Re-export error utilities
export { ERROR_CODES, getErrorMessage, setLocale, getLocale } from './errorCodes';
