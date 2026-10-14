import { Context } from 'grammy';
import { TelegramService } from '../../services/telegramService.js';
import { DatabaseRepository } from '../../database/repository.js';
import { getDiscordClient } from '../../services/discordService.js';
import { Logger } from '../../utils/logger.js';
import { calculateAccountAge } from '../../utils/accountAge.js';
import { formatExactUtc } from '../../utils/date.js';
import { DiscordMemberInfo, CustomerWithServers } from '../../types/index.js';

export interface UserAuthContext {
  isOwner: boolean;
  isCustomer: boolean;
  customer?: CustomerWithServers | null;
}

export async function checkUserAuthorization(ctx: Context): Promise<UserAuthContext | null> {
  const from = ctx.from;
  if (!from) return null;

  const isOwner = TelegramService.isOwnerAuthorized(from.id);
  let customer: CustomerWithServers | null = null;
  let isCustomer = false;

  if (!isOwner) {
    try {
      customer = await DatabaseRepository.getCustomerByTelegramId(from.id);
      if (customer && customer.status === 'active') {
        isCustomer = true;
      }
    } catch (err) {
      Logger.error('Failed to query customer record:', (err as Error).message);
    }
  }

  const isAuthorized = isOwner || isCustomer;

  try {
    await DatabaseRepository.upsertTelegramUser({
      telegramUserId: from.id,
      username: from.username || null,
      firstName: from.first_name || null,
      isAuthorized,
    });
  } catch (err) {
    Logger.error('Failed to record Telegram user:', (err as Error).message);
  }

  if (!isAuthorized) {
    await ctx.reply('⛔ Access denied. You are not authorized to use this bot.');
    return null;
  }

  return { isOwner, isCustomer, customer };
}

export async function handleTelegramCommand(
  ctx: Context,
  discordConnected: boolean,
  connectedGuildsCount: number,
  botVersion: string,
): Promise<void> {
  const text = ctx.message?.text?.trim() || '';
  if (!text) return;

  const chatType = ctx.chat?.type;
  const fromId = ctx.from?.id;
  const isOwner = fromId ? TelegramService.isOwnerAuthorized(fromId) : false;

  // 1. Process Hidden Owner Commands (Private chat + Owner + Prefixless matching)
  if (chatType === 'private' && isOwner && !text.startsWith('/')) {
    const handled = await handleOwnerCommand(ctx, text);
    if (handled) return;
  }

  // If message does not start with '/', ignore non-owner commands
  if (!text.startsWith('/')) return;

  const parts = text.split(/\s+/);
  const command = parts[0].split('@')[0].toLowerCase();
  const args = parts.slice(1);

  const auth = await checkUserAuthorization(ctx);
  if (!auth) {
    return;
  }

  switch (command) {
    case '/start':
      if (auth.isOwner) {
        await ctx.reply(
          '🤖 <b>Welcome to your Personal Discord + Telegram Info Bot!</b>\n\nUse /help to view available commands.',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          '🤖 <b>Welcome to DPM Bot!</b>\n\n' +
            'You are an authorized customer.\n' +
            '• <b>/help</b> - View available commands\n' +
            '• <b>/servers</b> - View your assigned Discord servers\n' +
            '• <b>/info &lt;discord_user_id&gt;</b> - Lookup member details on your assigned servers',
          { parse_mode: 'HTML' }
        );
      }
      break;

    case '/help':
      if (auth.isOwner) {
        await ctx.reply(
          `<b>📋 Available Telegram Commands:</b>\n\n` +
            `• <b>/start</b> - Start the bot\n` +
            `• <b>/help</b> - Show available commands\n` +
            `• <b>/status</b> - Show detailed system status\n` +
            `• <b>/servers</b> - List connected Discord servers\n` +
            `• <b>/info &lt;discord_user_id&gt;</b> - Lookup Discord member details`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(
          `<b>📋 Available Commands:</b>\n\n` +
            `• <b>/start</b> - Start the bot\n` +
            `• <b>/help</b> - Show available commands\n` +
            `• <b>/servers</b> - List your assigned Discord servers\n` +
            `• <b>/info &lt;discord_user_id&gt;</b> - Lookup member details on assigned servers`,
          { parse_mode: 'HTML' }
        );
      }
      break;

    case '/status': {
      if (!auth.isOwner) {
        await ctx.reply('⛔ Access denied. Only the owner can view system status.');
        return;
      }
      const diag = await TelegramService.getDiagnosticStatus(discordConnected, connectedGuildsCount, botVersion);
      const uptimeMin = (diag.status.uptimeSeconds / 60).toFixed(1);

      await ctx.reply(
        `<b>📊 Bot System Status</b>\n\n` +
          `• <b>Discord Gateway:</b> ${diag.status.discordConnected ? 'Connected 🟢' : 'Disconnected 🔴'}\n` +
          `• <b>Telegram Webhook:</b> ${diag.apiAuthWorking ? 'Active 🟢' : 'Error 🔴'}\n` +
          `• <b>Database:</b> ${diag.status.databaseConnected ? 'Connected 🟢' : 'Disconnected 🔴'}\n` +
          `• <b>Connected Discord Guilds:</b> ${diag.status.connectedGuildsCount}\n` +
          `• <b>Tracked Members:</b> ${diag.status.trackedMemberCount}\n` +
          `• <b>Uptime:</b> ${uptimeMin} minutes\n` +
          `• <b>Bot Version:</b> ${diag.status.version}\n` +
          `• <b>Pending Updates:</b> ${diag.pendingUpdateCount}` +
          (diag.lastError ? `\n• <b>Last Webhook Error:</b> <code>${diag.lastError.error}</code>` : ''),
        { parse_mode: 'HTML' }
      );
      break;
    }

    case '/servers': {
      let guilds = await DatabaseRepository.getAllGuilds();

      if (!auth.isOwner) {
        const allowedServerIds = auth.customer?.serverIds || [];
        guilds = guilds.filter((g) => allowedServerIds.includes(g.guildId));
      }

      if (guilds.length === 0) {
        await ctx.reply(
          auth.isOwner
            ? 'No Discord servers stored or connected yet.'
            : 'No Discord servers assigned to your account yet.'
        );
        return;
      }

      const lines = guilds.map((g) => `• <b>${escapeHtml(g.guildName)}</b> (ID: <code>${g.guildId}</code>)`);

      await ctx.reply(`<b>🏰 ${auth.isOwner ? 'Connected' : 'Assigned'} Discord Servers (${guilds.length}):</b>\n\n${lines.join('\n')}`, {
        parse_mode: 'HTML',
      });
      break;
    }

    case '/info': {
      const targetUserId = args[0]?.trim();
      if (!targetUserId) {
        await ctx.reply('⚠️ Please provide a Discord user ID.\n\nUsage: <code>/info &lt;discord_user_id&gt;</code>', {
          parse_mode: 'HTML',
        });
        return;
      }

      if (!/^\d{17,20}$/.test(targetUserId)) {
        await ctx.reply(
          `❌ Invalid Discord User ID format: <code>${escapeHtml(targetUserId)}</code>.\nDiscord User IDs must be 17 to 20 numeric digits.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      let member: DiscordMemberInfo | null = await DatabaseRepository.getMemberByDiscordId(targetUserId);

      // If customer, verify member belongs to an assigned server
      if (!auth.isOwner) {
        const allowedServerIds = auth.customer?.serverIds || [];
        if (member && !allowedServerIds.includes(member.guildId)) {
          // If stored member is from an unauthorized server, check if member exists on an authorized server
          member = null;
          for (const serverId of allowedServerIds) {
            const m = await DatabaseRepository.getMember(serverId, targetUserId);
            if (m) {
              member = m;
              break;
            }
          }
        }
      }

      // If not in database or to refresh live info, query Discord API directly if ready
      const discordClient = getDiscordClient();
      if (discordClient.isReady()) {
        try {
          const user = await discordClient.users.fetch(targetUserId).catch(() => null);
          if (user) {
            let matchedGuildName = 'Global Discord User';
            let matchedGuildId = member?.guildId || '0';
            let memberCount: number | undefined = undefined;
            let nickname: string | null = null;
            let joinedAt = member?.lastJoinedAt || new Date();
            let foundOnAuthorizedServer = false;

            const allowedServerIds = auth.isOwner ? null : (auth.customer?.serverIds || []);

            for (const guild of discordClient.guilds.cache.values()) {
              if (allowedServerIds && !allowedServerIds.includes(guild.id)) {
                continue;
              }
              const fetchedMember = await guild.members.fetch(user.id).catch(() => null);
              if (fetchedMember) {
                matchedGuildName = guild.name;
                matchedGuildId = guild.id;
                memberCount = guild.memberCount;
                nickname = fetchedMember.nickname || null;
                joinedAt = fetchedMember.joinedAt || joinedAt;
                foundOnAuthorizedServer = true;
                break;
              }
            }

            if (auth.isOwner || foundOnAuthorizedServer) {
              const liveMemberInfo: DiscordMemberInfo = {
                guildId: matchedGuildId,
                guildName: matchedGuildName,
                discordUserId: user.id,
                username: user.username,
                displayName: user.displayName || user.username,
                globalName: user.globalName || null,
                nickname: nickname,
                avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }) || null,
                isBot: user.bot,
                accountCreatedAt: user.createdAt,
                lastJoinedAt: joinedAt,
                memberCount: memberCount,
              };

              if (matchedGuildId !== '0') {
                await DatabaseRepository.upsertMember(liveMemberInfo).catch(() => null);
              }
              member = liveMemberInfo;
            }
          }
        } catch (err) {
          Logger.warn(`Discord user fetch error for ${targetUserId}:`, (err as Error).message);
        }
      }

      // Re-check customer server authorization on final member object
      if (!auth.isOwner && member) {
        const allowedServerIds = auth.customer?.serverIds || [];
        if (!allowedServerIds.includes(member.guildId)) {
          member = null;
        }
      }

      if (!member) {
        await ctx.reply(
          `❌ No Discord user or stored member found for ID: <code>${escapeHtml(targetUserId)}</code>.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const accountAge = calculateAccountAge(member.accountCreatedAt, member.lastJoinedAt);
      const createdUtc = formatExactUtc(member.accountCreatedAt);
      const joinedUtc = formatExactUtc(member.lastJoinedAt);

      await ctx.reply(
        `<b>👤 Discord Member Info</b>\n\n` +
          `• <b>Username:</b> ${escapeHtml(member.username)}\n` +
          `• <b>Display Name:</b> ${escapeHtml(member.displayName)}\n` +
          `• <b>Global Name:</b> ${member.globalName ? escapeHtml(member.globalName) : 'N/A'}\n` +
          `• <b>Nickname:</b> ${member.nickname ? escapeHtml(member.nickname) : 'None'}\n` +
          `• <b>Discord ID:</b> <code>${member.discordUserId}</code>\n` +
          `• <b>Account Type:</b> ${member.isBot ? 'Bot 🤖' : 'User 👤'}\n` +
          `• <b>Account Created:</b> ${createdUtc}\n` +
          `• <b>Account Age:</b> ${accountAge.formatted}\n` +
          `• <b>Server:</b> ${escapeHtml(member.guildName || member.guildId)}\n` +
          `• <b>Server ID:</b> <code>${member.guildId}</code>\n` +
          `• <b>Joined Server:</b> ${joinedUtc}`,
        { parse_mode: 'HTML' }
      );
      break;
    }

    default:
      await ctx.reply('Unknown command. Use /help to see available commands.');
      break;
  }
}

async function handleOwnerCommand(ctx: Context, text: string): Promise<boolean> {
  if (/^adduser\b/i.test(text)) {
    const addMatch = text.match(/^adduser\s+tg:(\S+)\s+dc:(\S+)$/i);
    if (!addMatch) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Discord IDs and try again.`);
      return true;
    }

    const tgId = parseInt(addMatch[1], 10);
    const dcId = addMatch[2];

    if (isNaN(tgId) || tgId <= 0 || !/^\d{17,20}$/.test(dcId)) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Discord IDs and try again.`);
      return true;
    }

    try {
      const res = await DatabaseRepository.addCustomer(tgId, dcId);
      if (res.isDuplicate) {
        await ctx.reply(`⚠️ DPM — Already Registered\n\nThis Telegram account already exists.`);
        return true;
      }

      await ctx.reply(
        `✅ DPM — Access Granted\n\n` +
          `Telegram: ${tgId}\n` +
          `Discord: ${dcId}\n` +
          `Status: Active\n` +
          `Server Access: None assigned`
      );
    } catch (err) {
      Logger.error('Failed to add customer via owner command:', (err as Error).message);
      await ctx.reply(`❌ DPM — Database Error\n\nCould not add customer. Please try again.`);
    }
    return true;
  }

  if (/^removeuser\b/i.test(text)) {
    const removeMatch = text.match(/^removeuser\s+tg:(\S+)$/i);
    if (!removeMatch) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Discord IDs and try again.`);
      return true;
    }

    const tgId = parseInt(removeMatch[1], 10);
    if (isNaN(tgId) || tgId <= 0) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Discord IDs and try again.`);
      return true;
    }

    try {
      const revoked = await DatabaseRepository.revokeCustomer(tgId);
      if (!revoked) {
        await ctx.reply(`❌ DPM — Invalid Information\n\nCustomer not found.`);
        return true;
      }

      await ctx.reply(
        `✅ DPM — Access Revoked\n\n` +
          `Telegram: ${tgId}\n` +
          `Status: Revoked`
      );
    } catch (err) {
      Logger.error('Failed to revoke customer via owner command:', (err as Error).message);
      await ctx.reply(`❌ DPM — Database Error\n\nCould not revoke customer. Please try again.`);
    }
    return true;
  }

  if (text.toLowerCase() === 'users') {
    try {
      const customers = await DatabaseRepository.getAllCustomers();
      if (customers.length === 0) {
        await ctx.reply(`<b>👥 Registered Customers (0)</b>\n\nNo customers registered.`, { parse_mode: 'HTML' });
        return true;
      }

      const lines = customers.map((c) => {
        const servers = c.serverIds.length > 0 ? c.serverIds.join(', ') : 'None';
        return `• Telegram: <code>${c.telegramUserId}</code> | Discord: <code>${c.discordUserId}</code> | Status: <b>${c.status}</b> | Servers: ${servers}`;
      });

      await ctx.reply(`<b>👥 Registered Customers (${customers.length}):</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
    } catch (err) {
      Logger.error('Failed to list customers via owner command:', (err as Error).message);
      await ctx.reply(`❌ DPM — Database Error\n\nCould not fetch customer list.`);
    }
    return true;
  }

  if (/^userinfo\b/i.test(text)) {
    const userInfoMatch = text.match(/^userinfo\s+tg:(\S+)$/i);
    if (!userInfoMatch) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram ID and try again.`);
      return true;
    }

    const tgId = parseInt(userInfoMatch[1], 10);
    if (isNaN(tgId) || tgId <= 0) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram ID and try again.`);
      return true;
    }

    try {
      const customer = await DatabaseRepository.getCustomerByTelegramId(tgId);
      if (!customer) {
        await ctx.reply(`❌ DPM — Invalid Information\n\nCustomer not found.`);
        return true;
      }

      const serversFormatted = customer.serverIds.length > 0 ? customer.serverIds.join(', ') : 'None assigned';

      await ctx.reply(
        `<b>👤 Customer Info</b>\n\n` +
          `Telegram ID: <code>${customer.telegramUserId}</code>\n` +
          `Discord ID: <code>${customer.discordUserId}</code>\n` +
          `Status: <b>${customer.status}</b>\n` +
          `Assigned Servers: ${serversFormatted}`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      Logger.error('Failed to fetch userinfo via owner command:', (err as Error).message);
      await ctx.reply(`❌ DPM — Database Error\n\nCould not fetch customer information.`);
    }
    return true;
  }

  if (/^grantserver\b/i.test(text)) {
    const grantMatch = text.match(/^grantserver\s+tg:(\S+)\s+server:(\S+)$/i);
    if (!grantMatch) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Server IDs and try again.`);
      return true;
    }

    const tgId = parseInt(grantMatch[1], 10);
    const serverId = grantMatch[2];

    if (isNaN(tgId) || tgId <= 0 || !/^\d{17,20}$/.test(serverId)) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Server IDs and try again.`);
      return true;
    }

    try {
      const res = await DatabaseRepository.grantCustomerServer(tgId, serverId);
      if (!res.customerFound) {
        await ctx.reply(`❌ DPM — Invalid Information\n\nCustomer not found.`);
        return true;
      }

      const customer = await DatabaseRepository.getCustomerByTelegramId(tgId);
      const serversFormatted = customer && customer.serverIds.length > 0 ? customer.serverIds.join(', ') : 'None assigned';

      await ctx.reply(
        `✅ DPM — Server Access Granted\n\n` +
          `Telegram: ${tgId}\n` +
          `Server ID: ${serverId}\n` +
          `Assigned Servers: ${serversFormatted}`
      );
    } catch (err) {
      Logger.error('Failed to grant server via owner command:', (err as Error).message);
      await ctx.reply(`❌ DPM — Database Error\n\nCould not grant server access.`);
    }
    return true;
  }

  if (/^revokeserver\b/i.test(text)) {
    const revokeServerMatch = text.match(/^revokeserver\s+tg:(\S+)\s+server:(\S+)$/i);
    if (!revokeServerMatch) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Server IDs and try again.`);
      return true;
    }

    const tgId = parseInt(revokeServerMatch[1], 10);
    const serverId = revokeServerMatch[2];

    if (isNaN(tgId) || tgId <= 0 || !/^\d{17,20}$/.test(serverId)) {
      await ctx.reply(`❌ DPM — Invalid Information\n\nCheck the Telegram and Server IDs and try again.`);
      return true;
    }

    try {
      const res = await DatabaseRepository.revokeCustomerServer(tgId, serverId);
      if (!res.customerFound) {
        await ctx.reply(`❌ DPM — Invalid Information\n\nCustomer not found.`);
        return true;
      }

      const customer = await DatabaseRepository.getCustomerByTelegramId(tgId);
      const serversFormatted = customer && customer.serverIds.length > 0 ? customer.serverIds.join(', ') : 'None assigned';

      await ctx.reply(
        `✅ DPM — Server Access Revoked\n\n` +
          `Telegram: ${tgId}\n` +
          `Server ID: ${serverId}\n` +
          `Assigned Servers: ${serversFormatted}`
      );
    } catch (err) {
      Logger.error('Failed to revoke server via owner command:', (err as Error).message);
      await ctx.reply(`❌ DPM — Database Error\n\nCould not revoke server access.`);
    }
    return true;
  }

  return false;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
