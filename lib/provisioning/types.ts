import type { Board } from '@/types';

export type EditionKey = 'clinic';

export interface EditionDefinition {
  key: EditionKey;
  label: string;
  description: string;
  enabledModules: string[];
  defaultBranding: {
    themeMode: 'light' | 'dark';
    accentColor: string;
  };
}

export interface TenantProvisioningInput {
  companyName: string;
  subdomain?: string;
  specialty: string;
  primaryGoal: string;
  serviceModel: string;
  leadChannel: string;
  notes?: string;
  provisioningMode?: 'full' | 'empty';
}

export interface TenantProvisioningResult {
  organizationId: string;
  provisioningRunId: string;
  editionKey: EditionKey;
  boardId?: string;
  boardName?: string;
  usedAI: boolean;
  fallbackUsed: boolean;
}

export interface ProvisioningBoardDraft {
  name: string;
  description?: string;
  stages: Array<{
    name: string;
    description: string;
    color: string;
    linkedLifecycleStage: string;
    estimatedDuration?: string;
  }>;
  automationSuggestions: string[];
  goal?: Board['goal'];
  agentPersona?: Board['agentPersona'];
  entryTrigger?: string;
}
