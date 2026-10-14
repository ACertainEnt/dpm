export interface DiscordGuildConfig {
  id?: number;
  guildId: string;
  guildName: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DiscordMemberInfo {
  id?: number;
  guildId: string;
  discordUserId: string;
  username: string;
  displayName: string;
  globalName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  isBot: boolean;
  accountCreatedAt: Date;
  lastJoinedAt: Date;
  guildName?: string;
  memberCount?: number;
  roles?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TelegramUserRecord {
  id?: number;
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  isAuthorized: boolean;
  createdAt?: Date;
  lastSeenAt?: Date;
}

export interface CustomerRecord {
  id?: number;
  telegramUserId: number;
  discordUserId: string;
  status: 'active' | 'revoked';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerWithServers extends CustomerRecord {
  serverIds: string[];
}

export interface BotStatusInfo {
  discordConnected: boolean;
  telegramWebhookStatus: string;
  databaseConnected: boolean;
  connectedGuildsCount: number;
  trackedMembersCount: number;
  uptimeSeconds: number;
  version: string;
}

export interface AccountAgeDetails {
  years: number;
  months: number;
  days: number;
  formatted: string;
}
