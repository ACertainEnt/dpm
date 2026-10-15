import { GuildMember, Role } from 'discord.js';
import { DatabaseRepository } from '../database/repository.js';
import { TelegramService } from './telegramService.js';
import { DiscordMemberInfo } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export class MemberService {
  /**
   * Extracts member information from a Discord GuildMember object safely.
   */
  static extractMemberInfo(member: GuildMember): DiscordMemberInfo {
    const user = member.user;
    const guild = member.guild;

    const accountCreatedAt = user?.createdAt || new Date(0);
    const lastJoinedAt = member?.joinedAt || new Date();

    let avatarUrl: string | null = null;
    if (typeof member.displayAvatarURL === 'function') {
      avatarUrl = member.displayAvatarURL({ extension: 'png', size: 256 });
    } else if (typeof user?.displayAvatarURL === 'function') {
      avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
    }

    return {
      guildId: guild.id,
      guildName: guild.name,
      discordUserId: user.id,
      username: user.username,
      displayName: member.displayName || user.displayName || user.username,
      globalName: user.globalName || null,
      nickname: member.nickname || null,
      avatarUrl: avatarUrl || null,
      isBot: Boolean(user.bot),
      accountCreatedAt,
      lastJoinedAt,
      memberCount: guild.memberCount,
      roles: member.roles?.cache ? Array.from(member.roles.cache.values()).map((r: Role) => r.name) : [],
    };
  }

  /**
   * Process a member join event idempotently, persist data in PostgreSQL, and notify authorized Telegram customers.
   */
  static async processMemberJoin(member: GuildMember): Promise<boolean> {
    const memberInfo = this.extractMemberInfo(member);
    const eventId = `join_${memberInfo.guildId}_${memberInfo.discordUserId}_${memberInfo.lastJoinedAt.getTime()}`;

    // Deduplication check using unique event ID in database
    const isNewEvent = await DatabaseRepository.logEventIdempotent({
      eventId,
      eventType: 'GUILD_MEMBER_ADD',
      guildId: memberInfo.guildId,
      discordUserId: memberInfo.discordUserId,
      details: {
        username: memberInfo.username,
        lastJoinedAt: memberInfo.lastJoinedAt.toISOString(),
      },
    });

    if (!isNewEvent) {
      Logger.info(`Duplicate member join event skipped: ${eventId}`);
      return false;
    }

    // Persist member information in database
    try {
      await DatabaseRepository.upsertMember(memberInfo);
    } catch (err) {
      Logger.error(`Failed to save member ${memberInfo.discordUserId} to database:`, (err as Error).message);
    }

    // Forward notification to authorized Telegram customers asynchronously and safely
    try {
      await TelegramService.notifyJoinEvent(memberInfo);
    } catch (err) {
      Logger.error(`Telegram notification error (Discord processing continues):`, (err as Error).message);
    }

    return true;
  }
}
