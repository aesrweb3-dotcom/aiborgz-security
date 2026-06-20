const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const rumbleDb = require('./rumble-database');
const xVerify = require('./x-verify');

const BASE_URL = process.env.BASE_URL || process.env.RUMBLE_BASE_URL;

const rumbleCommands = [
  new SlashCommandBuilder()
    .setName('rumble-set-tweet')
    .setDescription('Set the tweet users must engage with to enter the Rumble Room (admin only)')
    .addStringOption(opt => opt.setName('url').setDescription('Full tweet URL').setRequired(true))
    .addStringOption(opt => opt.setName('x_username').setDescription('Your X username to check follows against, e.g. AIBORGZ').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('rumble-set-entry')
    .setDescription('Set the entry message and role for the Rumble Room gate (admin only)')
    .addStringOption(opt => opt.setName('message_id').setDescription('Message ID users react to enter').setRequired(true))
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel the entry message is in').setRequired(true))
    .addRoleOption(opt => opt.setName('role').setDescription('Role granted once verified').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('rumble-status')
    .setDescription('Check current Rumble Room gate configuration (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

async function resolveXUsername(username) {
  const appBearer = process.env.X_BEARER_TOKEN;
  if (!appBearer) throw new Error('X_BEARER_TOKEN not configured');
  const clean = username.replace('@', '');
  const res = await fetch(`https://api.twitter.com/2/users/by/username/${clean}`, {
    headers: { Authorization: `Bearer ${appBearer}` },
  });
  if (!res.ok) throw new Error(`Could not find X user @${clean}`);
  const data = await res.json();
  return data.data;
}

async function handleRumbleCommand(interaction) {
  if (interaction.commandName === 'rumble-set-tweet') {
    await interaction.deferReply({ ephemeral: true });
    const url = interaction.options.getString('url');
    const xUsername = interaction.options.getString('x_username');

    const tweetId = xVerify.extractTweetId(url);
    if (!tweetId) {
      return interaction.editReply('That doesn\'t look like a valid tweet URL. Paste the full link to the tweet.');
    }

    try {
      const xUser = await resolveXUsername(xUsername);
      rumbleDb.setGuildSettings(interaction.guild.id, {
        tweet_url: url,
        target_x_user_id: xUser.id,
        target_x_username: xUser.username,
      });
      await interaction.editReply(`Rumble Room tweet set.\nTweet: ${url}\nAccount to follow: @${xUser.username}`);
    } catch (err) {
      await interaction.editReply(`Error: ${err.message}`);
    }
    return;
  }

  if (interaction.commandName === 'rumble-set-entry') {
    await interaction.deferReply({ ephemeral: true });
    const messageId = interaction.options.getString('message_id');
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('role');

    rumbleDb.setGuildSettings(interaction.guild.id, {
      entry_message_id: messageId,
      entry_channel_id: channel.id,
      rumble_role_id: role.id,
    });

    await interaction.editReply(`Rumble Room entry gate set.\nMessage: ${messageId} in <#${channel.id}>\nRole granted on verify: <@&${role.id}>`);
    return;
  }

  if (interaction.commandName === 'rumble-status') {
    const settings = rumbleDb.getGuildSettings(interaction.guild.id);
    if (!settings) {
      return interaction.reply({ content: 'Rumble Room gate is not configured yet. Run /rumble-set-tweet and /rumble-set-entry first.', ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setColor(0x00e5ff)
      .setTitle('// RUMBLE ROOM GATE STATUS //')
      .addFields(
        { name: 'Tweet', value: settings.tweet_url || 'Not set', inline: false },
        { name: 'Target X account', value: settings.target_x_username ? `@${settings.target_x_username}` : 'Not set', inline: true },
        { name: 'Entry message', value: settings.entry_message_id || 'Not set', inline: true },
        { name: 'Entry channel', value: settings.entry_channel_id ? `<#${settings.entry_channel_id}>` : 'Not set', inline: true },
        { name: 'Verified role', value: settings.rumble_role_id ? `<@&${settings.rumble_role_id}>` : 'Not set', inline: true },
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleRumbleReaction(reaction, user, client) {
  if (user.bot) return;

  const guildId = reaction.message.guild?.id;
  if (!guildId) return;

  const settings = rumbleDb.getGuildSettings(guildId);
  if (!settings || !settings.entry_message_id || !settings.entry_channel_id) return;

  if (reaction.message.id !== settings.entry_message_id) return;
  if (reaction.message.channel.id !== settings.entry_channel_id) return;

  const existing = rumbleDb.getVerification(user.id, guildId, settings.tweet_url);
  if (existing && existing.verified) {
    return;
  }

  try {
    await reaction.users.remove(user.id);
  } catch (err) {
    console.warn('Could not remove unverified reaction:', err.message);
  }

  const verifyUrl = `${BASE_URL}/rumble/start?discordId=${user.id}&guildId=${guildId}`;

  const embed = new EmbedBuilder()
    .setColor(0xff0080)
    .setTitle('// RUMBLE ROOM — VERIFICATION REQUIRED //')
    .setDescription(
      `You need to verify on X before you can enter the Rumble Room.\n\n` +
      `Steps:\n` +
      `1. Follow @${settings.target_x_username || 'AIBORGZ'}\n` +
      `2. Like and retweet the entry tweet\n` +
      `3. Click the link below and log in with X to verify\n\n` +
      `[Verify on X →](${verifyUrl})\n\n` +
      `Once verified, go back and react to the entry message again.`
    )
    .setFooter({ text: 'AIBORGZ Security // Rumble Room Gate' });

  try {
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.warn(`Could not DM ${user.tag}, DMs likely closed:`, err.message);
  }
}

async function enforceRumbleRoleIntegrity(client) {
  for (const guild of client.guilds.cache.values()) {
    const settings = rumbleDb.getGuildSettings(guild.id);
    if (!settings || !settings.rumble_role_id || !settings.tweet_url) continue;

    try {
      const role = await guild.roles.fetch(settings.rumble_role_id);
      if (!role) continue;

      const members = await guild.members.fetch();
      for (const member of members.values()) {
        if (!member.roles.cache.has(settings.rumble_role_id)) continue;
        const verification = rumbleDb.getVerification(member.id, guild.id, settings.tweet_url);
        if (!verification || !verification.verified) {
          await member.roles.remove(settings.rumble_role_id).catch(() => {});
          console.log(`Removed unverified Rumble role from ${member.user.tag}`);
        }
      }
    } catch (err) {
      console.error('enforceRumbleRoleIntegrity error:', err.message);
    }
  }
}

module.exports = {
  rumbleCommands,
  handleRumbleCommand,
  handleRumbleReaction,
  enforceRumbleRoleIntegrity,
};
