import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramService, setTelegramBot } from '../services/telegramService.js';
import { DatabaseRepository } from '../database/repository.js';
import { CustomerRecord } from '../types/index.js';

vi.mock('../config/index.js', () => ({
  getConfig: () => ({
    TELEGRAM_BOT_TOKEN: 'test_bot_token_123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    TELEGRAM_OWNER_ID: 123456789,
    TELEGRAM_WEBHOOK_SECRET: 'test_secret',
    APP_URL: 'https://example.com',
  }),
}));

describe('Customer Notification Routing & Owner Separation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setTelegramBot(null);
  });

  it('1. A customer event reaches the correct customer Telegram chat, NOT the owner', async () => {
    vi.spyOn(DatabaseRepository, 'getActiveCustomersForGuild').mockResolvedValue([
      { telegramUserId: 555555555, discordUserId: '111111111111111111', status: 'active' } as CustomerRecord,
    ]);

    const sendMessageSpy = vi.fn().mockResolvedValue({});
    const fakeBot = { api: { sendMessage: sendMessageSpy } };
    setTelegramBot(fakeBot as unknown as ReturnType<typeof getTelegramBot>);

    const memberInfo = {
      guildId: 'server_A',
      guildName: 'Server A',
      discordUserId: 'user_999',
      username: 'newmember',
      displayName: 'New Member',
      globalName: null,
      nickname: null,
      avatarUrl: null,
      isBot: false,
      accountCreatedAt: new Date('2021-01-01'),
      lastJoinedAt: new Date('2023-01-01'),
    };

    await TelegramService.notifyJoinEvent(memberInfo);

    expect(DatabaseRepository.getActiveCustomersForGuild).toHaveBeenCalledWith('server_A');
    expect(sendMessageSpy).toHaveBeenCalledOnce();
    expect(sendMessageSpy).toHaveBeenCalledWith(555555555, expect.stringContaining('Server A'), expect.anything());
    expect(sendMessageSpy).not.toHaveBeenCalledWith(123456789, expect.anything(), expect.anything());
  });

  it('2. The owner receives owner-specific system alerts through notifyOwnerSystemAlert', async () => {
    const sendMessageSpy = vi.fn().mockResolvedValue({});
    const fakeBot = { api: { sendMessage: sendMessageSpy } };
    setTelegramBot(fakeBot as unknown as ReturnType<typeof getTelegramBot>);

    await TelegramService.notifyOwnerSystemAlert('🚨 System alert test');

    expect(sendMessageSpy).toHaveBeenCalledOnce();
    expect(sendMessageSpy).toHaveBeenCalledWith(123456789, '🚨 System alert test', expect.anything());
  });

  it('3. Two customers monitoring different servers receive only their respective notifications', async () => {
    vi.spyOn(DatabaseRepository, 'getActiveCustomersForGuild').mockImplementation(async (guildId) => {
      if (guildId === 'server_A') {
        return [{ telegramUserId: 11111, discordUserId: 'dc1', status: 'active' } as CustomerRecord];
      }
      if (guildId === 'server_B') {
        return [{ telegramUserId: 22222, discordUserId: 'dc2', status: 'active' } as CustomerRecord];
      }
      return [];
    });

    const sendMessageSpy = vi.fn().mockResolvedValue({});
    const fakeBot = { api: { sendMessage: sendMessageSpy } };
    setTelegramBot(fakeBot as unknown as ReturnType<typeof getTelegramBot>);

    const eventServerA = {
      guildId: 'server_A',
      guildName: 'Server A',
      discordUserId: 'user_1',
      username: 'user1',
      displayName: 'User 1',
      globalName: null,
      nickname: null,
      avatarUrl: null,
      isBot: false,
      accountCreatedAt: new Date(),
      lastJoinedAt: new Date(),
    };

    await TelegramService.notifyJoinEvent(eventServerA);

    expect(sendMessageSpy).toHaveBeenCalledOnce();
    expect(sendMessageSpy).toHaveBeenCalledWith(11111, expect.stringContaining('Server A'), expect.anything());
    expect(sendMessageSpy).not.toHaveBeenCalledWith(22222, expect.anything(), expect.anything());
  });

  it('4. Two authorized customers monitoring the same server each receive notifications', async () => {
    vi.spyOn(DatabaseRepository, 'getActiveCustomersForGuild').mockResolvedValue([
      { telegramUserId: 11111, discordUserId: 'dc1', status: 'active' } as CustomerRecord,
      { telegramUserId: 22222, discordUserId: 'dc2', status: 'active' } as CustomerRecord,
    ]);

    const sendMessageSpy = vi.fn().mockResolvedValue({});
    const fakeBot = { api: { sendMessage: sendMessageSpy } };
    setTelegramBot(fakeBot as unknown as ReturnType<typeof getTelegramBot>);

    const memberInfo = {
      guildId: 'server_shared',
      guildName: 'Shared Server',
      discordUserId: 'user_joint',
      username: 'jointuser',
      displayName: 'Joint User',
      globalName: null,
      nickname: null,
      avatarUrl: null,
      isBot: false,
      accountCreatedAt: new Date(),
      lastJoinedAt: new Date(),
    };

    await TelegramService.notifyJoinEvent(memberInfo);

    expect(sendMessageSpy).toHaveBeenCalledTimes(2);
    expect(sendMessageSpy).toHaveBeenCalledWith(11111, expect.anything(), expect.anything());
    expect(sendMessageSpy).toHaveBeenCalledWith(22222, expect.anything(), expect.anything());
    expect(sendMessageSpy).not.toHaveBeenCalledWith(123456789, expect.anything(), expect.anything());
  });

  it('5. A customer with failing/invalid destination logs error and does NOT fallback to owner', async () => {
    vi.spyOn(DatabaseRepository, 'getActiveCustomersForGuild').mockResolvedValue([
      { telegramUserId: 88888, discordUserId: 'dc_failing', status: 'active' } as CustomerRecord,
    ]);

    const sendMessageSpy = vi.fn().mockRejectedValue(new Error('Telegram API Error: Chat not found'));
    const fakeBot = { api: { sendMessage: sendMessageSpy } };
    setTelegramBot(fakeBot as unknown as ReturnType<typeof getTelegramBot>);

    const memberInfo = {
      guildId: 'server_fail',
      guildName: 'Failing Server',
      discordUserId: 'user_err',
      username: 'erruser',
      displayName: 'Err User',
      globalName: null,
      nickname: null,
      avatarUrl: null,
      isBot: false,
      accountCreatedAt: new Date(),
      lastJoinedAt: new Date(),
    };

    await TelegramService.notifyJoinEvent(memberInfo);

    expect(sendMessageSpy).toHaveBeenCalledOnce();
    expect(sendMessageSpy).toHaveBeenCalledWith(88888, expect.anything(), expect.anything());
    expect(sendMessageSpy).not.toHaveBeenCalledWith(123456789, expect.anything(), expect.anything());
  });

  it('6. An unauthorized customer or unassigned server event does NOT deliver to unauthorized users or owner', async () => {
    vi.spyOn(DatabaseRepository, 'getActiveCustomersForGuild').mockResolvedValue([]);

    const sendMessageSpy = vi.fn().mockResolvedValue({});
    const fakeBot = { api: { sendMessage: sendMessageSpy } };
    setTelegramBot(fakeBot as unknown as ReturnType<typeof getTelegramBot>);

    const memberInfo = {
      guildId: 'unassigned_server',
      guildName: 'Unassigned Server',
      discordUserId: 'user_orphan',
      username: 'orphan',
      displayName: 'Orphan',
      globalName: null,
      nickname: null,
      avatarUrl: null,
      isBot: false,
      accountCreatedAt: new Date(),
      lastJoinedAt: new Date(),
    };

    await TelegramService.notifyJoinEvent(memberInfo);

    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});
