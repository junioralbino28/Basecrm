export const CHANNEL_PROVIDERS = ['evolution'] as const;
export const CHANNEL_TYPES = ['whatsapp'] as const;
export const CHANNEL_STATUSES = ['pending', 'connected', 'disconnected', 'error'] as const;

export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type ChannelConnectionStatus = (typeof CHANNEL_STATUSES)[number];

export type ChannelConnectionConfig = {
  apiUrl?: string;
  instanceName?: string;
  webhookUrl?: string;
  apiKey?: string;
};

export type ChannelConnectionMetadata = {
  phoneNumber?: string;
  apiKeyLast4?: string;
  notes?: string;
};

export type ChannelConnection = {
  id: string;
  organization_id: string;
  provider: ChannelProvider;
  channel_type: ChannelType;
  name: string;
  status: ChannelConnectionStatus;
  config: ChannelConnectionConfig;
  metadata: ChannelConnectionMetadata;
  last_healthcheck_at: string | null;
  created_at: string;
  updated_at: string;
};
