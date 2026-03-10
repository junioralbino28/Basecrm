import type { EditionDefinition, EditionKey } from './types';

const EDITIONS: Record<EditionKey, EditionDefinition> = {
  clinic: {
    key: 'clinic',
    label: 'CRM Clinica',
    description: 'Edicao interna voltada para operacao de clinicas com implantacao concierge.',
    enabledModules: ['crm_core', 'ai_assistant', 'boards_pipeline', 'contacts', 'activities'],
    defaultBranding: {
      themeMode: 'light',
      accentColor: '#0f766e',
    },
  },
};

export function getEditionDefinition(key: EditionKey): EditionDefinition {
  return EDITIONS[key];
}

export function listEditionDefinitions(): EditionDefinition[] {
  return Object.values(EDITIONS);
}
