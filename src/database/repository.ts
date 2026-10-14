import { getPool } from './client.js';
import {
  DiscordGuildConfig,
  DiscordMemberInfo,
  TelegramUserRecord,
  CustomerRecord,
  CustomerWithServers,
} from '../types/index.js';
import { Logger } from '../utils/logger.js';

export class DatabaseRepository {
  // --- DISCORD GUILDS ---

  static async upsertGuild(guild: DiscordGuildConfig): Promise<DiscordGuildConfig> {
    const pool = getPool();
    const query = `
      INSERT INTO discord_guilds (guild_id, guild_name, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (guild_id) DO UPDATE SET
        guild_name = EXCLUDED.guild_name,
        updated_at = NOW()
      RETURNING id, guild_id AS "guildId", guild_name AS "guildName",
                created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const res = await pool.query(query, [guild.guildId, guild.guildName]);
    return res.rows[0];
  }

  static async getGuild(guildId: string): Promise<DiscordGuildConfig | null> {
    const pool = getPool();
    const query = `
      SELECT id, guild_id AS "guildId", guild_name AS "guildName",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM discord_guilds
      WHERE guild_id = $1;
    `;
    const res = await pool.query(query, [guildId]);
    return res.rows[0] || null;
  }

  static async getAllGuilds(): Promise<DiscordGuildConfig[]> {
    const pool = getPool();
    const query = `
      SELECT id, guild_id AS "guildId", guild_name AS "guildName",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM discord_guilds
      ORDER BY guild_name ASC;
    `;
    const res = await pool.query(query);
    return res.rows;
  }

  // --- DISCORD MEMBERS ---

  static async upsertMember(member: DiscordMemberInfo): Promise<DiscordMemberInfo> {
    const pool = getPool();
    // First ensure guild exists
    await this.upsertGuild({
      guildId: member.guildId,
      guildName: member.guildName || member.guildId,
    });

    const query = `
      INSERT INTO discord_members (
        guild_id, discord_user_id, username, display_name, global_name,
        nickname, avatar, is_bot, account_created_at, last_joined_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        global_name = EXCLUDED.global_name,
        nickname = EXCLUDED.nickname,
        avatar = EXCLUDED.avatar,
        is_bot = EXCLUDED.is_bot,
        account_created_at = EXCLUDED.account_created_at,
        last_joined_at = EXCLUDED.last_joined_at,
        updated_at = NOW()
      RETURNING id, guild_id AS "guildId", discord_user_id AS "discordUserId",
                username, display_name AS "displayName", global_name AS "globalName",
                nickname, avatar AS "avatarUrl", is_bot AS "isBot",
                account_created_at AS "accountCreatedAt", last_joined_at AS "lastJoinedAt",
                created_at AS "createdAt", updated_at AS "updatedAt";
    `;

    const res = await pool.query(query, [
      member.guildId,
      member.discordUserId,
      member.username,
      member.displayName,
      member.globalName,
      member.nickname,
      member.avatarUrl,
      member.isBot,
      member.accountCreatedAt,
      member.lastJoinedAt,
    ]);

    return res.rows[0];
  }

  static async getMember(guildId: string, discordUserId: string): Promise<DiscordMemberInfo | null> {
    const pool = getPool();
    const query = `
      SELECT m.id, m.guild_id AS "guildId", m.discord_user_id AS "discordUserId",
             m.username, m.display_name AS "displayName", m.global_name AS "globalName",
             m.nickname, m.avatar AS "avatarUrl", m.is_bot AS "isBot",
             m.account_created_at AS "accountCreatedAt", m.last_joined_at AS "lastJoinedAt",
             m.created_at AS "createdAt", m.updated_at AS "updatedAt",
             g.guild_name AS "guildName"
      FROM discord_members m
      JOIN discord_guilds g ON m.guild_id = g.guild_id
      WHERE m.guild_id = $1 AND m.discord_user_id = $2;
    `;
    const res = await pool.query(query, [guildId, discordUserId]);
    return res.rows[0] || null;
  }

  static async getMemberByDiscordId(discordUserId: string): Promise<DiscordMemberInfo | null> {
    const pool = getPool();
    const query = `
      SELECT m.id, m.guild_id AS "guildId", m.discord_user_id AS "discordUserId",
             m.username, m.display_name AS "displayName", m.global_name AS "globalName",
             m.nickname, m.avatar AS "avatarUrl", m.is_bot AS "isBot",
             m.account_created_at AS "accountCreatedAt", m.last_joined_at AS "lastJoinedAt",
             m.created_at AS "createdAt", m.updated_at AS "updatedAt",
             g.guild_name AS "guildName"
      FROM discord_members m
      JOIN discord_guilds g ON m.guild_id = g.guild_id
      WHERE m.discord_user_id = $1
      ORDER BY m.last_joined_at DESC
      LIMIT 1;
    `;
    const res = await pool.query(query, [discordUserId]);
    return res.rows[0] || null;
  }

  static async getTotalMemberCount(): Promise<number> {
    const pool = getPool();
    const query = `SELECT COUNT(DISTINCT discord_user_id) FROM discord_members;`;
    const res = await pool.query(query);
    return parseInt(res.rows[0].count, 10);
  }

  // --- TELEGRAM USERS ---

  static async upsertTelegramUser(user: TelegramUserRecord): Promise<TelegramUserRecord> {
    const pool = getPool();
    const query = `
      INSERT INTO telegram_users (telegram_user_id, username, first_name, authorized, last_seen_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        authorized = EXCLUDED.authorized,
        last_seen_at = NOW()
      RETURNING id, telegram_user_id AS "telegramUserId", username,
                first_name AS "firstName", authorized AS "isAuthorized",
                created_at AS "createdAt", last_seen_at AS "lastSeenAt";
    `;
    const res = await pool.query(query, [
      user.telegramUserId,
      user.username || null,
      user.firstName || null,
      user.isAuthorized,
    ]);
    return res.rows[0];
  }

  // --- CUSTOMER AUTHORIZATIONS ---

  static async addCustomer(telegramUserId: number, discordUserId: string): Promise<{ success: boolean; isDuplicate: boolean; customer?: CustomerRecord }> {
    const pool = getPool();
    try {
      const query = `
        INSERT INTO customers (telegram_user_id, discord_user_id, status, updated_at)
        VALUES ($1, $2, 'active', NOW())
        ON CONFLICT (telegram_user_id) DO NOTHING
        RETURNING id, telegram_user_id AS "telegramUserId", discord_user_id AS "discordUserId",
                  status, created_at AS "createdAt", updated_at AS "updatedAt";
      `;
      const res = await pool.query(query, [telegramUserId, discordUserId]);
      if (res.rows.length === 0) {
        return { success: false, isDuplicate: true };
      }
      return { success: true, isDuplicate: false, customer: res.rows[0] };
    } catch (err) {
      Logger.error('Error adding customer:', (err as Error).message);
      throw err;
    }
  }

  static async revokeCustomer(telegramUserId: number): Promise<CustomerRecord | null> {
    const pool = getPool();
    const query = `
      UPDATE customers
      SET status = 'revoked', updated_at = NOW()
      WHERE telegram_user_id = $1
      RETURNING id, telegram_user_id AS "telegramUserId", discord_user_id AS "discordUserId",
                status, created_at AS "createdAt", updated_at AS "updatedAt";
    `;
    const res = await pool.query(query, [telegramUserId]);
    return res.rows[0] || null;
  }

  static async getCustomerByTelegramId(telegramUserId: number): Promise<CustomerWithServers | null> {
    const pool = getPool();
    const queryCust = `
      SELECT id, telegram_user_id AS "telegramUserId", discord_user_id AS "discordUserId",
             status, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM customers
      WHERE telegram_user_id = $1;
    `;
    const resCust = await pool.query(queryCust, [telegramUserId]);
    if (resCust.rows.length === 0) return null;

    const customer = resCust.rows[0];
    const queryServers = `
      SELECT guild_id AS "guildId"
      FROM customer_servers
      WHERE telegram_user_id = $1
      ORDER BY guild_id ASC;
    `;
    const resServers = await pool.query(queryServers, [telegramUserId]);
    const serverIds = resServers.rows.map((r: { guildId: string }) => r.guildId);

    return { ...customer, serverIds };
  }

  static async getAllCustomers(): Promise<CustomerWithServers[]> {
    const pool = getPool();
    const query = `
      SELECT c.id, c.telegram_user_id AS "telegramUserId", c.discord_user_id AS "discordUserId",
             c.status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
             COALESCE(
               ARRAY_AGG(cs.guild_id ORDER BY cs.guild_id) FILTER (WHERE cs.guild_id IS NOT NULL),
               '{}'
             ) AS "serverIds"
      FROM customers c
      LEFT JOIN customer_servers cs ON c.telegram_user_id = cs.telegram_user_id
      GROUP BY c.id, c.telegram_user_id, c.discord_user_id, c.status, c.created_at, c.updated_at
      ORDER BY c.created_at ASC;
    `;
    const res = await pool.query(query);
    return res.rows.map((row) => ({
      ...row,
      serverIds: Array.isArray(row.serverIds) ? row.serverIds : [],
    }));
  }

  static async grantCustomerServer(telegramUserId: number, guildId: string): Promise<{ success: boolean; customerFound: boolean; isDuplicate: boolean; serverIds: string[] }> {
    const pool = getPool();
    const customer = await this.getCustomerByTelegramId(telegramUserId);
    if (!customer) {
      return { success: false, customerFound: false, isDuplicate: false, serverIds: [] };
    }

    try {
      const query = `
        INSERT INTO customer_servers (telegram_user_id, guild_id)
        VALUES ($1, $2)
        ON CONFLICT (telegram_user_id, guild_id) DO NOTHING;
      `;
      const res = await pool.query(query, [telegramUserId, guildId]);
      const updatedCustomer = await this.getCustomerByTelegramId(telegramUserId);
      return {
        success: true,
        customerFound: true,
        isDuplicate: (res.rowCount ?? 0) === 0,
        serverIds: updatedCustomer?.serverIds || [],
      };
    } catch (err) {
      Logger.error('Error granting server to customer:', (err as Error).message);
      throw err;
    }
  }

  static async revokeCustomerServer(telegramUserId: number, guildId: string): Promise<{ success: boolean; customerFound: boolean; wasAssigned: boolean; serverIds: string[] }> {
    const pool = getPool();
    const customer = await this.getCustomerByTelegramId(telegramUserId);
    if (!customer) {
      return { success: false, customerFound: false, wasAssigned: false, serverIds: [] };
    }

    const query = `
      DELETE FROM customer_servers
      WHERE telegram_user_id = $1 AND guild_id = $2;
    `;
    const res = await pool.query(query, [telegramUserId, guildId]);
    const updatedCustomer = await this.getCustomerByTelegramId(telegramUserId);
    return {
      success: true,
      customerFound: true,
      wasAssigned: (res.rowCount ?? 0) > 0,
      serverIds: updatedCustomer?.serverIds || [],
    };
  }

  static async getActiveCustomersForGuild(guildId: string): Promise<CustomerRecord[]> {
    const pool = getPool();
    const query = `
      SELECT c.id, c.telegram_user_id AS "telegramUserId", c.discord_user_id AS "discordUserId",
             c.status, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
      FROM customers c
      JOIN customer_servers cs ON c.telegram_user_id = cs.telegram_user_id
      WHERE cs.guild_id = $1 AND c.status = 'active';
    `;
    const res = await pool.query(query, [guildId]);
    return res.rows;
  }

  // --- BOT EVENTS & IDEMPOTENCY ---

  /**
   * Attempts to log an event with a unique event_id. Returns true if inserted, false if duplicate.
   */
  static async logEventIdempotent(event: {
    eventId: string;
    eventType: string;
    guildId?: string | null;
    discordUserId?: string | null;
    telegramUserId?: number | null;
    details?: Record<string, unknown> | null;
  }): Promise<boolean> {
    const pool = getPool();
    const query = `
      INSERT INTO bot_events (event_id, event_type, guild_id, discord_user_id, telegram_user_id, details)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (event_id) DO NOTHING;
    `;
    try {
      const res = await pool.query(query, [
        event.eventId,
        event.eventType,
        event.guildId || null,
        event.discordUserId || null,
        event.telegramUserId || null,
        event.details ? JSON.stringify(event.details) : null,
      ]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      Logger.error('Failed to log event idempotently:', (err as Error).message);
      return false;
    }
  }
}
