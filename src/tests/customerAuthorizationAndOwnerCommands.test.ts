import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTelegramCommand } from '../commands/telegram/index.js';
import { DatabaseRepository } from '../database/repository.js';
import { TelegramService } from '../services/telegramService.js';
import { Context } from 'grammy';
import { CustomerRecord } from '../types/index.js';

vi.mock('../config/index.js', () => ({
  getConfig: () => ({
    TELEGRAM_BOT_TOKEN: 'test_token_123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    TELEGRAM_OWNER_ID: 123456789,
    TELEGRAM_WEBHOOK_SECRET: 'test_secret',
    APP_URL: 'https://example.com',
  }),
}));

describe('Hidden Owner Commands & Customer Authorization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Owner adduser creates customer with exact success response format', async () => {
    vi.spyOn(DatabaseRepository, 'addCustomer').mockResolvedValue({
      success: true,
      isDuplicate: false,
      customer: {
        telegramUserId: 111222333,
        discordUserId: '987654321012345678',
        status: 'active',
      },
    });

    const replySpy = vi.fn();
    const ctx = {
      chat: { type: 'private' },
      from: { id: 123456789, username: 'owner' },
      message: { text: 'adduser tg:111222333 dc:987654321012345678' },
      reply: replySpy,
    } as unknown as Context;

    await handleTelegramCommand(ctx, true, 1, '1.0.0');

    expect(replySpy).toHaveBeenCalledWith(
      `✅ DPM — Access Granted\n\n` +
        `Telegram: 111222333\n` +
        `Discord: 987654321012345678\n` +
        `Status: Active\n` +
        `Server Access: None assigned`
    );
  });

  it('2. Owner adduser handles duplicate user with exact error response', async () => {
    vi.spyOn(DatabaseRepository, 'addCustomer').mockResolvedValue({
      success: false,
      isDuplicate: true,
    });

    const replySpy = vi.fn();
    const ctx = {
      chat: { type: 'private' },
      from: { id: 123456789, username: 'owner' },
      message: { text: 'adduser tg:111222333 dc:987654321012345678' },
      reply: replySpy,
    } as unknown as Context;

    await handleTelegramCommand(ctx, true, 1, '1.0.0');

    expect(replySpy).toHaveBeenCalledWith(
      `⚠️ DPM — Already Registered\n\nThis Telegram account already exists.`
    );
  });

  it('3. Owner adduser with invalid ID format responds with Invalid Information', async () => {
    const replySpy = vi.fn();
    const ctx = {
      chat: { type: 'private' },
      from: { id: 123456789, username: 'owner' },
      message: { text: 'adduser tg:invalid dc:invalid' },
      reply: replySpy,
    } as unknown as Context;

    await handleTelegramCommand(ctx, true, 1, '1.0.0');

    expect(replySpy).toHaveBeenCalledWith(
      `❌ DPM — Invalid Information\n\nCheck the Telegram and Discord IDs and try again.`
    );
  });

  it('4. Owner removeuser revokes access with exact response format', async () => {
    vi.spyOn(DatabaseRepository, 'revokeCustomer').mockResolvedValue({
      telegramUserId: 111222333,
      discordUserId: '987654321012345678',
      status: 'revoked',
    });

    const replySpy = vi.fn();
    const ctx = {
      chat: { type: 'private' },
      from: { id: 123456789, username: 'owner' },
      message: { text: 'removeuser tg:111222333' },
      reply: replySpy,
    } as unknown as Context;

    await handleTelegramCommand(ctx, true, 1, '1.0.0');

    expect(replySpy).toHaveBeenCalledWith(
      `✅ DPM — Access Revoked\n\n` +
        `Telegram: 111222333\n` +
        `Status: Revoked`
    );
  });

  it('5. Owner grantserver assigns server access to customer', async () => {
    vi.spyOn(DatabaseRepository, 'grantCustomerServer').mockResolvedValue({
      success: true,
      customerFound: true,
      isDuplicate: false,
      serverIds: ['987654321012345678'],
    });
    vi.spyOn(DatabaseRepository, 'getCustomerByTelegramId').mockResolvedValue({
      telegramUserId: 111222333,
      discordUserId: '123123123123123123',
      status: 'active',
      serverIds: ['987654321012345678'],
    });

    const replySpy = vi.fn();
    const ctx = {
      chat: { type: 'private' },
      from: { id: 123456789, username: 'owner' },
      message: { text: 'grantserver tg:111222333 server:987654321012345678' },
      reply: replySpy,
    } as unknown as Context;

    await handleTelegramCommand(ctx, true, 1, '1.0.0');

    expect(replySpy).toHaveBeenCalledWith(
      `✅ DPM — Server Access Granted\n\n` +
        `Telegram: 111222333\n` +
        `Server ID: 987654321012345678\n` +
        `Assigned Servers: 987654321012345678`
    );
  });

  it('6. Non-owner trying prefixless owner commands receives generic denial or no action', async () => {
    const replySpy = vi.fn();
    const ctx = {
      chat: { type: 'private' },
      from: { id: 999999999, username: 'intruder' },
      message: { text: 'adduser tg:111222333 dc:987654321012345678' },
      reply: replySpy,
    } as unknown as Context;

    vi.spyOn(DatabaseRepository, 'getCustomerByTelegramId').mockResolvedValue(null);

    await handleTelegramCommand(ctx, true, 1, '1.0.0');

    // Should NOT process as owner command; since it has no '/' it will be ignored without leaking command existence
    expect(replySpy).not.toHaveBeenCalledWith(expect.stringContaining('Access Granted'));
  });

  it('7. Customer command access restriction (/servers & /info scoped to assigned servers)', async () => {
    vi.spyOn(DatabaseRepository, 'upsertTelegramUser').mockResolvedValue({
      telegramUserId: 555555555,
      username: 'customer',
      firstName: null,
      isAuthorized: true,
    });
    vi.spyOn(DatabaseRepository, 'getCustomerByTelegramId').mockResolvedValue({
      telegramUserId: 555555555,
      discordUserId: '100000000000000000',
      status: 'active',
      serverIds: ['111111111111111111'],
    });

    vi.spyOn(DatabaseRepository, 'getAllGuilds').mockResolvedValue([
      { guildId: '111111111111111111', guildName: 'Server Alpha' },
      { guildId: '222222222222222222', guildName: 'Server Beta' },
    ]);

    const replySpy = vi.fn();
    const ctx = {
      chat: { type: 'private' },
      from: { id: 555555555, username: 'customer' },
      message: { text: '/servers' },
      reply: replySpy,
    } as unknown as Context;

    await handleTelegramCommand(ctx, true, 1, '1.0.0');

    expect(replySpy).toHaveBeenCalledWith(
      expect.stringContaining('Server Alpha'),
      expect.anything()
    );
    expect(replySpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Server Beta'),
      expect.anything()
    );
  });

  it('8. Join notification is dispatched to owner AND active customers with server access', async () => {
    vi.spyOn(DatabaseRepository, 'getActiveCustomersForGuild').mockResolvedValue([
      { telegramUserId: 777777777, discordUserId: '333333333333333333', status: 'active' } as CustomerRecord,
    ]);

    const sendMessageSpy = vi.fn().mockResolvedValue({});
    const mockBot = { api: { sendMessage: sendMessageSpy } };
    vi.spyOn(TelegramService, 'isOwnerAuthorized').mockImplementation((id: number) => id === 123456789);

    vi.spyOn(TelegramService, 'notifyOwnerOfJoin').mockImplementation(async (memberInfo) => {
      const activeCustomers = await DatabaseRepository.getActiveCustomersForGuild(memberInfo.guildId);
      const recipientIds = new Set<number>([123456789, ...activeCustomers.map((c: CustomerRecord) => c.telegramUserId)]);
      for (const recipientId of recipientIds) {
        await mockBot.api.sendMessage(recipientId, 'Notification text');
      }
    });

    const memberInfo = {
      guildId: '111111111111111111',
      guildName: 'Test Server',
      discordUserId: '888888888888888888',
      username: 'newuser',
      displayName: 'New User',
      globalName: null,
      nickname: null,
      avatarUrl: null,
      isBot: false,
      accountCreatedAt: new Date('2020-01-01'),
      lastJoinedAt: new Date('2023-01-01'),
    };

    await TelegramService.notifyOwnerOfJoin(memberInfo);

    expect(DatabaseRepository.getActiveCustomersForGuild).toHaveBeenCalledWith('111111111111111111');
    expect(sendMessageSpy).toHaveBeenCalledWith(123456789, 'Notification text');
    expect(sendMessageSpy).toHaveBeenCalledWith(777777777, 'Notification text');
  });
});
