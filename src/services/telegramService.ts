import { Bot } from 'grammy';
import { getConfig } from '../config/index.js';
import { Logger } from '../utils/logger.js';
import { DatabaseRepository } from '../database/repository.js';
import { testDatabaseConnection } from '../database/client.js';
import { DiscordMemberInfo, CustomerRecord } from '../types/index.js';
import { buildTelegramJoinNotification } from '../formatters/telegramNotification.js';

let telegramBot: Bot | null = null;
let webhookErrorLog: { timestamp: Date; error: string } | null = null;

export function getTelegramBot(): Bot {
  if (!telegramBot) {
    const config = getConfig();
    telegramBot = new Bot(config.TELEGRAM_BOT_TOKEN);
  }
  return telegramBot;
}

export function setTelegramBot(bot: Bot | null): void {
  telegramBot = bot;
}

export function recordTelegramWebhookError(err: Error | string): void {
  const errorMessage = typeof err === 'string' ? err : err.message;
  webhookErrorLog = {
    timestamp: new Date(),
    error: errorMessage,
  };
}

export class TelegramService {
  /**
   * Register slash commands with Telegram Bot API so they appear in Telegram's UI.
   */
  static async registerCommands(): Promise<void> {
    try {
      const bot = getTelegramBot();
      await bot.api.setMyCommands([
        { command: 'start', description: 'Start the bot' },
        { command: 'help', description: 'Show available commands' },
        { command: 'servers', description: 'Show connected Discord servers' },
        { command: 'info', description: 'Get Discord member information (<discord_user_id>)' },
      ]);
      Logger.info('Registered Telegram slash commands with Telegram API.');
    } catch (err) {
      Logger.error('Failed to register Telegram commands:', (err as Error).message);
    }
  }

  /**
   * Set the webhook URL with Telegram Bot API.
   */
  static async setupWebhook(): Promise<void> {
    try {
      const config = getConfig();
      const bot = getTelegramBot();
      const webhookUrl = `${config.APP_URL}/api/telegram/webhook`;

      await bot.api.setWebhook(webhookUrl, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      });
      Logger.info(`Telegram webhook set to ${webhookUrl}`);
    } catch (err) {
      Logger.error('Failed to set Telegram webhook:', (err as Error).message);
      recordTelegramWebhookError(err as Error);
    }
  }

  /**
   * Returns diagnostic webhook/API status safely without leaking secrets.
   */
  static async getDiagnosticStatus(discordConnected: boolean, connectedGuildsCount: number, version: string) {
    const config = getConfig();
    let apiAuthWorking = false;
    let pendingUpdateCount = 0;

    try {
      const bot = getTelegramBot();
      const webhookInfo = await bot.api.getWebhookInfo();
      apiAuthWorking = true;
      pendingUpdateCount = webhookInfo.pending_update_count;
    } catch (err) {
      apiAuthWorking = false;
      recordTelegramWebhookError(err as Error);
    }

    const dbConnected = await testDatabaseConnection();
    const trackedMemberCount = await DatabaseRepository.getTotalMemberCount().catch(() => 0);

    const safeWebhookUrl = `${config.APP_URL}/api/telegram/webhook`;

    return {
      apiAuthWorking,
      webhookUrl: safeWebhookUrl,
      pendingUpdateCount,
      lastError: webhookErrorLog,
      status: {
        discordConnected,
        telegramStatus: apiAuthWorking ? 'Connected / Webhook Active' : 'API Error or Webhook Inactive',
        databaseConnected: dbConnected,
        connectedGuildsCount,
        trackedMemberCount,
        uptimeSeconds: Math.floor(process.uptime()),
        version,
      },
    };
  }

  /**
   * Send a member join notification strictly to active customers authorized for that guild.
   */
  static async notifyJoinEvent(memberInfo: DiscordMemberInfo): Promise<void> {
    const bot = getTelegramBot();
    const message = buildTelegramJoinNotification(memberInfo);

    let activeCustomers: CustomerRecord[] = [];
    try {
      activeCustomers = await DatabaseRepository.getActiveCustomersForGuild(memberInfo.guildId);
    } catch (err) {
      Logger.error(`Failed to fetch active customers for guild ${memberInfo.guildId}:`, (err as Error).message);
      return;
    }

    if (activeCustomers.length === 0) {
      Logger.info(`No active customers subscribed to notifications for guild ${memberInfo.guildId}`);
      return;
    }

    const recipientIds = new Set<number>();
    for (const cust of activeCustomers) {
      if (cust.status === 'active' && cust.telegramUserId) {
        recipientIds.add(cust.telegramUserId);
      }
    }

    for (const recipientId of recipientIds) {
      try {
        await bot.api.sendMessage(recipientId, message, {
          parse_mode: 'HTML',
        });
        Logger.info(`Sent join notification for user ${memberInfo.discordUserId} to Telegram recipient ${recipientId}`);
      } catch (err) {
        Logger.error(`Failed to send Telegram notification to user ${recipientId}:`, (err as Error).message);
        recordTelegramWebhookError(err as Error);
        // DO NOT throw or crash process, and DO NOT fallback to owner!
      }
    }
  }

  /**
   * Backward-compatible alias for notifyJoinEvent.
   */
  static async notifyOwnerOfJoin(memberInfo: DiscordMemberInfo): Promise<void> {
    return this.notifyJoinEvent(memberInfo);
  }

  /**
   * Send owner-specific system alert to TELEGRAM_OWNER_ID.
   */
  static async notifyOwnerSystemAlert(message: string): Promise<void> {
    try {
      const config = getConfig();
      const bot = getTelegramBot();
      await bot.api.sendMessage(config.TELEGRAM_OWNER_ID, message, {
        parse_mode: 'HTML',
      });
      Logger.info(`Sent system alert to Telegram owner ${config.TELEGRAM_OWNER_ID}`);
    } catch (err) {
      Logger.error(`Failed to send system alert to owner:`, (err as Error).message);
      recordTelegramWebhookError(err as Error);
    }
  }

  /**
   * Check if a Telegram user ID matches TELEGRAM_OWNER_ID.
   */
  static isOwnerAuthorized(userId: number): boolean {
    const config = getConfig();
    return userId === config.TELEGRAM_OWNER_ID;
  }
}
