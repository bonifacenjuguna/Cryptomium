import { mainReplyKeyboard } from '../keyboards.js';
import { getState, setState } from '../db.js';

/**
 * Registers /start and the channel-connect flow.
 *
 * Flow: owner DMs /start -> bot asks them to forward a message from the
 * target channel (or send its @username) -> bot verifies it is an admin
 * there via getChatMember -> saves channel_id -> confirms in DM -> posts
 * a one-time confirmation message to the channel itself.
 *
 * `pendingConnect` is a tiny in-memory flag tracking whether the owner is
 * mid-flow. It's fine for this to reset on restart — worst case the owner
 * just sends /start again.
 */
const pendingConnect = new Set();

export function registerStartHandlers(bot, { onChannelConnected }) {
  bot.start(async ctx => {
    const existingChannelId = await getState('channel_id');
    const existingChannelName = await getState('channel_name');

    if (existingChannelId) {
      await ctx.reply(
        `Already connected to ${existingChannelName || existingChannelId}.\n\n` +
        `Forward a message from a different channel here if you want to switch.`,
        mainReplyKeyboard
      );
    } else {
      pendingConnect.add(ctx.from.id);
      await ctx.reply(
        'Welcome. To connect me to your channel:\n\n' +
        '1. Add me as an admin there (needs "Post Messages" permission)\n' +
        '2. Forward me any message from that channel, or just send its @username',
        mainReplyKeyboard
      );
    }
  });

  // Forwarded message from the target channel.
  bot.on('message', async (ctx, next) => {
    const isForwardFromChannel = ctx.message.forward_from_chat?.type === 'channel';
    if (!isForwardFromChannel) return next();

    await tryConnectChannel(ctx, ctx.message.forward_from_chat.id, onChannelConnected);
  });

  // @username sent as plain text while a connect is pending.
  bot.on('text', async (ctx, next) => {
    if (!pendingConnect.has(ctx.from.id)) return next();
    const text = ctx.message.text.trim();
    if (!text.startsWith('@')) return next();

    await tryConnectChannel(ctx, text, onChannelConnected);
  });

  async function tryConnectChannel(ctx, channelIdentifier, onConnected) {
    try {
      const member = await ctx.telegram.getChatMember(channelIdentifier, ctx.botInfo.id);
      const isAdmin = member.status === 'administrator' || member.status === 'creator';
      if (!isAdmin) {
        await ctx.reply('I found that channel, but I\'m not an admin there yet. Add me as admin first, then try again.');
        return;
      }

      const chat = await ctx.telegram.getChat(channelIdentifier);
      await setState('channel_id', String(chat.id));
      await setState('channel_name', chat.title || chat.username || String(chat.id));
      pendingConnect.delete(ctx.from.id);

      await ctx.reply(`Connected to ${chat.title || chat.username} ✅`, mainReplyKeyboard);
      await onConnected(chat.id);
    } catch (err) {
      await ctx.reply(
        `Couldn't verify that channel (${err.message}). Make sure I'm added as admin there, then try again.`
      );
    }
  }
}
