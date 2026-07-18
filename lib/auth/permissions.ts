export const APP_PERMISSIONS = [
  // Painel
  'dashboard.view',
  'overview.view',
  // Contatos e Leads
  'contacts.view',
  'contacts.edit',
  'contacts.delete',
  'contacts.import_export',
  // Funis (Kanban)
  'funnels.view',
  'funnels.move',
  'funnels.manage',
  'deals.manage',
  // Conversas e WhatsApp
  'conversations.access',
  'conversations.reply',
  'whatsapp.access',
  'whatsapp.manage_connection',
  // Atividades e Tarefas
  'activities.view',
  'activities.manage',
  'tasks.view',
  'tasks.manage',
  'call_list.access',
  // Atendimentos
  'atendimentos.view',
  'atendimentos.manage',
  // Agenda
  'agenda.view',
  'agenda.manage',
  // Relatórios
  'reports.view',
  'reports.finance',
  'reports.professionals',
  // IA
  'ai.use',
  'ai.configure',
  // Automações
  'automation.edit',
  'automation.operate',
  // Configurações
  'settings.general',
  'settings.products',
  'settings.professionals',
  'settings.finance',
  'settings.integrations',
  'settings.audit',
  'settings.users.manage',
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

export type PermissionDefinition = {
  key: AppPermission;
  label: string;
  description: string;
  /** Grupo/área para renderizar os toggles agrupados na UI. */
  group: string;
};

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Painel
  { key: 'dashboard.view', label: 'Ver painel', description: 'Abrir o painel/dashboard com os indicadores.', group: 'Painel' },
  { key: 'overview.view', label: 'Ver visão geral', description: 'Abrir a visão geral do dia (central de trabalho).', group: 'Painel' },
  // Contatos e Leads
  { key: 'contacts.view', label: 'Ver contatos e leads', description: 'Abrir a lista de contatos/leads e seus detalhes.', group: 'Contatos e Leads' },
  { key: 'contacts.edit', label: 'Criar e editar contatos', description: 'Cadastrar novos contatos e editar os existentes.', group: 'Contatos e Leads' },
  { key: 'contacts.delete', label: 'Excluir contatos', description: 'Remover contatos da base.', group: 'Contatos e Leads' },
  { key: 'contacts.import_export', label: 'Importar e exportar', description: 'Importar contatos em massa e exportar a base.', group: 'Contatos e Leads' },
  // Funis (Kanban)
  { key: 'funnels.view', label: 'Ver os funis', description: 'Abrir os funis (Kanban) e acompanhar os cards.', group: 'Funis' },
  { key: 'funnels.move', label: 'Mover cards entre etapas', description: 'Arrastar/mover os cards de uma etapa para outra.', group: 'Funis' },
  { key: 'funnels.manage', label: 'Gerenciar funis e etapas', description: 'Criar, editar e remover funis e suas etapas.', group: 'Funis' },
  { key: 'deals.manage', label: 'Criar e editar negócios', description: 'Criar e editar os negócios (cards) dentro dos funis.', group: 'Funis' },
  // Conversas e WhatsApp (as 5 originais mantidas)
  { key: 'conversations.access', label: 'Conversations', description: 'Abrir o inbox operacional e acompanhar conversas da clinica.', group: 'Conversas e WhatsApp' },
  { key: 'conversations.reply', label: 'Responder conversas', description: 'Enviar mensagens, registrar saida e notas internas na conversa.', group: 'Conversas e WhatsApp' },
  { key: 'whatsapp.access', label: 'WhatsApp', description: 'Abrir a area do WhatsApp, gerar QR code, testar conexao e reconectar o numero.', group: 'Conversas e WhatsApp' },
  { key: 'whatsapp.manage_connection', label: 'Configurar WhatsApp', description: 'Editar API URL, instance, chave e configuracoes estruturais da conexao.', group: 'Conversas e WhatsApp' },
  // Atividades e Tarefas
  { key: 'activities.view', label: 'Ver atividades', description: 'Acompanhar o histórico e a linha do tempo de atividades.', group: 'Atividades e Tarefas' },
  { key: 'activities.manage', label: 'Gerenciar atividades', description: 'Criar, editar e concluir atividades.', group: 'Atividades e Tarefas' },
  { key: 'tasks.view', label: 'Ver tarefas', description: 'Abrir a lista de tarefas.', group: 'Atividades e Tarefas' },
  { key: 'tasks.manage', label: 'Gerenciar tarefas', description: 'Criar, editar e concluir tarefas.', group: 'Atividades e Tarefas' },
  { key: 'call_list.access', label: 'Lista de ligações', description: 'Abrir e trabalhar a lista de ligações.', group: 'Atividades e Tarefas' },
  // Atendimentos
  { key: 'atendimentos.view', label: 'Ver atendimentos', description: 'Abrir a lista de atendimentos registrados.', group: 'Atendimentos' },
  { key: 'atendimentos.manage', label: 'Registrar atendimentos', description: 'Registrar e editar atendimentos (procedimento, valor, etc.).', group: 'Atendimentos' },
  // Agenda
  { key: 'agenda.view', label: 'Ver agenda', description: 'Abrir a agenda e ver os horários.', group: 'Agenda' },
  { key: 'agenda.manage', label: 'Gerenciar agenda', description: 'Marcar, remarcar e cancelar na agenda.', group: 'Agenda' },
  // Relatórios
  { key: 'reports.view', label: 'Relatórios gerais', description: 'Abrir os relatórios gerais.', group: 'Relatórios' },
  { key: 'reports.finance', label: 'Relatório financeiro', description: 'Ver o relatório financeiro (faturamento, comissões, custos).', group: 'Relatórios' },
  { key: 'reports.professionals', label: 'Relatório por profissional', description: 'Ver o desempenho e os números por profissional.', group: 'Relatórios' },
  // IA
  { key: 'ai.use', label: 'Usar a IA', description: 'Usar o assistente de IA no dia a dia.', group: 'IA' },
  { key: 'ai.configure', label: 'Configurar a IA', description: 'Editar persona, comportamento e chave da IA.', group: 'IA' },
  // Automações
  { key: 'automation.edit', label: 'Editar automações', description: 'Criar e alterar fluxos, passos, arestas e templates de automação.', group: 'Automações' },
  { key: 'automation.operate', label: 'Operar automações', description: 'Acompanhar e operar automações publicadas sem alterar o grafo.', group: 'Automações' },
  // Configurações
  { key: 'settings.general', label: 'Configurações gerais', description: 'Abrir e editar as configurações gerais da clínica.', group: 'Configurações' },
  { key: 'settings.products', label: 'Produtos e procedimentos', description: 'Gerenciar o catálogo de produtos/procedimentos.', group: 'Configurações' },
  { key: 'settings.professionals', label: 'Profissionais', description: 'Gerenciar os profissionais (dentistas).', group: 'Configurações' },
  { key: 'settings.finance', label: 'Financeiro', description: 'Gerenciar comissões, custos fixos e taxas de cartão.', group: 'Configurações' },
  { key: 'settings.integrations', label: 'Integrações', description: 'Gerenciar as integrações do sistema.', group: 'Configurações' },
  { key: 'settings.audit', label: 'Log de auditoria', description: 'Ver o histórico de auditoria do sistema.', group: 'Configurações' },
  { key: 'settings.users.manage', label: 'Gerenciar equipe', description: 'Convidar usuarios, remover equipe e ajustar permissoes individuais.', group: 'Configurações' },
];

export type PermissionOverrideMap = Partial<Record<AppPermission, boolean>>;

/** Mapa completo (todas as chaves) com um mesmo valor. */
function fullPermissionMap(value: boolean): Record<AppPermission, boolean> {
  return APP_PERMISSIONS.reduce<Record<AppPermission, boolean>>((acc, key) => {
    acc[key] = value;
    return acc;
  }, {} as Record<AppPermission, boolean>);
}

/** Mapa "tudo liberado" exceto as chaves negadas. */
function permissionMapExcept(denied: readonly AppPermission[]): Record<AppPermission, boolean> {
  const map = fullPermissionMap(true);
  for (const key of denied) map[key] = false;
  return map;
}

/** Cargo operacional de clínica (secretária): tudo operacional liberado, sensível negado. */
const CLINIC_STAFF_DENIED: readonly AppPermission[] = [
  'contacts.delete',
  'contacts.import_export',
  'funnels.manage',
  'whatsapp.access',
  'whatsapp.manage_connection',
  'reports.view',
  'reports.finance',
  'reports.professionals',
  'ai.configure',
  'automation.edit',
  'settings.general',
  'settings.products',
  'settings.professionals',
  'settings.finance',
  'settings.integrations',
  'settings.audit',
  'settings.users.manage',
];

/** Equipe da agência: amplo, mas sem configurar conexão nem áreas mais sensíveis. */
const AGENCY_STAFF_DENIED: readonly AppPermission[] = [
  'whatsapp.manage_connection',
  'settings.users.manage',
  'settings.finance',
  'settings.audit',
];

export const ROLE_PERMISSION_DEFAULTS: Record<string, Record<AppPermission, boolean>> = {
  agency_admin: fullPermissionMap(true),
  admin: fullPermissionMap(true),
  clinic_admin: fullPermissionMap(true),
  agency_staff: permissionMapExcept(AGENCY_STAFF_DENIED),
  clinic_staff: permissionMapExcept(CLINIC_STAFF_DENIED),
  vendedor: permissionMapExcept(CLINIC_STAFF_DENIED),
};

export function getDefaultPermissionMap(role: string | null | undefined): Record<AppPermission, boolean> {
  const normalizedRole = role === 'admin'
    ? 'agency_admin'
    : role === 'vendedor'
      ? 'clinic_staff'
      : role;

  return {
    ...ROLE_PERMISSION_DEFAULTS.clinic_staff,
    ...(normalizedRole ? ROLE_PERMISSION_DEFAULTS[normalizedRole] ?? {} : {}),
  };
}

export function resolvePermissionMap(
  role: string | null | undefined,
  overrides?: PermissionOverrideMap | null
): Record<AppPermission, boolean> {
  const base = getDefaultPermissionMap(role);
  if (!overrides) return base;

  return APP_PERMISSIONS.reduce<Record<AppPermission, boolean>>((acc, permissionKey) => {
    acc[permissionKey] = overrides[permissionKey] ?? base[permissionKey];
    return acc;
  }, {} as Record<AppPermission, boolean>);
}

export function hasPermission(
  role: string | null | undefined,
  permission: AppPermission,
  overrides?: PermissionOverrideMap | null
) {
  return resolvePermissionMap(role, overrides)[permission];
}
