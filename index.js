require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const db = require('./database');
const { checkNewMember, compareAvatar } = require('./detection');
const { handleCommand } = require('./commands');
const rumbleGate = require('./rumble-gate');
const { attachDiscordClient } = require('./rumble-oauth-server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.GuildMember, Partials.User, Partials.Message, Partials.Reaction],
});

// ── READY ──
client.once('ready', () => {
  console.log(`✅ AIBORGZ Security online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: '// MONITORING THE NETWORK //', type: 3 }],
    status: 'online',
  });

  // Hand the Discord client to the Rumble OAuth server so it can assign roles
  attachDiscordClient(client);

  // Every 10 minutes, strip the Rumble role from anyone who isn't actually verified
  setInterval(() => rumbleGate.enforceRumbleRoleIntegrity(client), 10 * 60 * 1000);
});

// ── RUMBLE ROOM VERIFY BUTTON ──
client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId === 'rumble_verify_button') {
    try {
      await rumbleGate.handleRumbleButton(interaction);
    } catch (err) {
      console.error('Rumble button handler error:', err.message);
    }
  }
});

// ── MEMBER JOIN ──
client.on('guildMemberAdd', async member => {
  try {
    const result = await checkNewMember(member, client);
    if (result.flagged) {
      await handleFlaggedMember(member, result);
    }
  } catch (err) {
    console.error('Error on member join:', err);
  }
});

// ── BAN EVENT — store banned user data ──
client.on('guildBanAdd', async ban => {
  try {
    const user = ban.user;
    const avatarURL = user.displayAvatarURL({ extension: 'png', size: 256 });

    db.storeBan({
      userId:    user.id,
      username:  user.username,
      avatarURL: avatarURL,
      guildId:   ban.guild.id,
      timestamp: Date.now(),
    });

    console.log(`📌 Stored ban data for ${user.username} (${user.id})`);
  } catch (err) {
    console.error('Error storing ban:', err);
  }
});

// ── UNBAN EVENT — remove from ban list ──
client.on('guildBanRemove', async ban => {
  try {
    db.removeBan(ban.user.id, ban.guild.id);
    console.log(`✅ Removed ban data for ${ban.user.username}`);
  } catch (err) {
    console.error('Error removing ban:', err);
  }
});

// ── BUTTON INTERACTIONS ──
client.on('interactionCreate', async interaction => {
  // Rumble Room admin slash commands
  if (interaction.isChatInputCommand() && interaction.commandName.startsWith('rumble-')) {
    return rumbleGate.handleRumbleCommand(interaction);
  }

  if (!interaction.isButton()) return;
  if (interaction.customId === 'rumble_verify_button') return; // handled separately, no permission gate

  const [action, userId] = interaction.customId.split('_');

  if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
    return interaction.reply({ content: '❌ You do not have permission to do this.', ephemeral: true });
  }

  const guild = interaction.guild;

  if (action === 'approve') {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member) {
      const quarantineRole = guild.roles.cache.find(r => r.name === process.env.QUARANTINE_ROLE || r.name === 'Quarantine');
      if (quarantineRole) await member.roles.remove(quarantineRole);
    }
    await interaction.update({
      content: `✅ <@${userId}> approved by <@${interaction.user.id}>`,
      components: [],
    });

  } else if (action === 'ban') {
    try {
      await guild.members.ban(userId, { reason: `Alt account — banned via AIBORGZ Security by ${interaction.user.tag}` });
      await interaction.update({
        content: `🔨 <@${userId}> banned by <@${interaction.user.id}>`,
        components: [],
      });
    } catch (err) {
      await interaction.reply({ content: `❌ Could not ban: ${err.message}`, ephemeral: true });
    }

  } else if (action === 'kick') {
    try {
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (member) await member.kick(`Kicked via AIBORGZ Security by ${interaction.user.tag}`);
      await interaction.update({
        content: `👢 <@${userId}> kicked by <@${interaction.user.id}>`,
        components: [],
      });
    } catch (err) {
      await interaction.reply({ content: `❌ Could not kick: ${err.message}`, ephemeral: true });
    }
  }
});

// ── COMMANDS ──
client.on('messageCreate', async message => {
  if (!message.content.startsWith(process.env.PREFIX || '!sec')) return;
  if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) return;
  await handleCommand(message, client, db);
});

// ── HANDLE FLAGGED MEMBER ──
async function handleFlaggedMember(member, result) {
  const guild = member.guild;
  const logChannelName = process.env.LOG_CHANNEL || 'security-log';
  const logChannel = guild.channels.cache.find(c => c.name === logChannelName);

  // Apply quarantine role
  const quarantineRole = guild.roles.cache.find(r =>
    r.name === (process.env.QUARANTINE_ROLE || 'Quarantine')
  );
  if (quarantineRole) {
    await member.roles.add(quarantineRole).catch(console.error);
  }

  // Build alert embed
  const embed = new EmbedBuilder()
    .setColor(result.severity === 'HIGH' ? 0xff0080 : 0xffbd2e)
    .setTitle(`⚠ AIBORGZ SECURITY — ${result.severity} RISK`)
    .setDescription(`<@${member.user.id}> joined and has been flagged`)
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: '👤 User', value: `${member.user.tag} (${member.user.id})`, inline: true },
      { name: '📅 Account Age', value: result.accountAge, inline: true },
      { name: '🚨 Risk Score', value: `${result.score}/100`, inline: true },
      { name: '🔍 Flags Triggered', value: result.flags.join('\n') || 'None', inline: false },
    )
    .setTimestamp()
    .setFooter({ text: 'AIBORGZ Security // Year 2189' });

  // Add matched ban info if any
  if (result.matchedBan) {
    embed.addFields({
      name: '🔗 Possible Alt Of',
      value: `${result.matchedBan.username} (${result.matchedBan.userId})\nBanned: <t:${Math.floor(result.matchedBan.timestamp / 1000)}:R>`,
      inline: false,
    });
  }

  // Action buttons
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${member.user.id}`)
      .setLabel('✅ Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`kick_${member.user.id}`)
      .setLabel('👢 Kick')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ban_${member.user.id}`)
      .setLabel('🔨 Ban')
      .setStyle(ButtonStyle.Danger),
  );

  if (logChannel) {
    await logChannel.send({ embeds: [embed], components: [row] });
  }

  // DM the flagged user
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0x00e5ff)
      .setTitle('// AIBORGZ SECURITY //')
      .setDescription(
        'Your account has been flagged for review by our security system.\n\n' +
        'This is an automated check. A moderator will review your account shortly.\n\n' +
        'If you believe this is a mistake please be patient — you will be approved if your account is legitimate.\n\n' +
        '// AIBORGZ COLLECTIVE — YEAR 2189 //'
      )
      .setTimestamp();
    await member.user.send({ embeds: [dmEmbed] });
  } catch (err) {
    // DMs disabled — ignore
  }
}

client.login(process.env.DISCORD_TOKEN);
