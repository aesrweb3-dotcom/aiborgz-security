const { EmbedBuilder } = require('discord.js');

const PREFIX = process.env.PREFIX || '!sec';

async function handleCommand(message, client, db) {
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  switch (cmd) {

    // ── !sec stats ──
    case 'stats': {
      const stats = db.getStats(message.guild.id);
      const embed = new EmbedBuilder()
        .setColor(0x00e5ff)
        .setTitle('// AIBORGZ SECURITY — STATS //')
        .addFields(
          { name: '🔨 Total Bans Tracked', value: String(stats.totalBans), inline: true },
          { name: '🚨 Total Flagged Joins', value: String(stats.totalFlags), inline: true },
          { name: '📅 Flagged (Last 24h)', value: String(stats.last24h), inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'AIBORGZ Security // Year 2189' });
      await message.reply({ embeds: [embed] });
      break;
    }

    // ── !sec recent ──
    case 'recent': {
      const flagged = db.getRecentFlagged(message.guild.id, 10);
      if (!flagged.length) {
        return message.reply('✅ No flagged joins recorded yet.');
      }
      const embed = new EmbedBuilder()
        .setColor(0xff0080)
        .setTitle('// RECENT FLAGGED JOINS //')
        .setDescription(
          flagged.map((f, i) =>
            `**${i + 1}.** ${f.username} (${f.user_id}) — Score: ${f.score} — <t:${Math.floor(f.timestamp / 1000)}:R>`
          ).join('\n')
        )
        .setTimestamp()
        .setFooter({ text: 'AIBORGZ Security // Year 2189' });
      await message.reply({ embeds: [embed] });
      break;
    }

    // ── !sec bans ──
    case 'bans': {
      const bans = db.getAllBans(message.guild.id);
      if (!bans.length) {
        return message.reply('📭 No bans tracked yet. Bans will be logged automatically going forward.');
      }
      const embed = new EmbedBuilder()
        .setColor(0xff0080)
        .setTitle(`// BAN LIST — ${bans.length} UNITS //')`)
        .setDescription(
          bans.slice(0, 20).map((b, i) =>
            `**${i + 1}.** ${b.username} (${b.user_id}) — <t:${Math.floor(b.timestamp / 1000)}:R>`
          ).join('\n') + (bans.length > 20 ? `\n_...and ${bans.length - 20} more_` : '')
        )
        .setTimestamp()
        .setFooter({ text: 'AIBORGZ Security // Year 2189' });
      await message.reply({ embeds: [embed] });
      break;
    }

    // ── !sec addban <userId> ──
    case 'addban': {
      const userId = args[0];
      if (!userId) return message.reply('Usage: `!sec addban <userId>`');
      try {
        const user = await client.users.fetch(userId);
        db.storeBan({
          userId: user.id,
          username: user.username,
          avatarURL: user.displayAvatarURL({ extension: 'png', size: 256 }),
          guildId: message.guild.id,
          timestamp: Date.now(),
        });
        await message.reply(`✅ **${user.username}** (${userId}) added to ban tracking list.`);
      } catch {
        await message.reply('❌ Could not find that user. Check the ID and try again.');
      }
      break;
    }

    // ── !sec removeban <userId> ──
    case 'removeban': {
      const userId = args[0];
      if (!userId) return message.reply('Usage: `!sec removeban <userId>`');
      db.removeBan(userId, message.guild.id);
      await message.reply(`✅ Removed ${userId} from ban tracking list.`);
      break;
    }

    // ── !sec check <userId> ──
    case 'check': {
      const userId = args[0];
      if (!userId) return message.reply('Usage: `!sec check <userId>`');
      try {
        const member = await message.guild.members.fetch(userId);
        const { checkNewMember } = require('./detection');
        const result = await checkNewMember(member, client);
        if (!result.flagged) {
          await message.reply(`✅ **${member.user.tag}** — No flags detected. Risk score: ${result.score || 0}/100`);
        } else {
          const embed = new EmbedBuilder()
            .setColor(0xff0080)
            .setTitle(`// MANUAL CHECK — ${result.severity} RISK //`)
            .addFields(
              { name: '👤 User', value: member.user.tag, inline: true },
              { name: '🚨 Score', value: `${result.score}/100`, inline: true },
              { name: '📅 Account Age', value: result.accountAge, inline: true },
              { name: '🔍 Flags', value: result.flags.join('\n') || 'None' },
            )
            .setTimestamp();
          await message.reply({ embeds: [embed] });
        }
      } catch {
        await message.reply('❌ Could not find that member in this server.');
      }
      break;
    }

    // ── !sec approve <userId> ──
    case 'approve': {
      const userId = args[0];
      if (!userId) return message.reply('Usage: `!sec approve <userId>`');
      db.approveUser(userId, message.guild.id);
      const quarantineRole = message.guild.roles.cache.find(r =>
        r.name === (process.env.QUARANTINE_ROLE || 'Quarantine')
      );
      const member = message.guild.members.cache.get(userId);
      if (member && quarantineRole) await member.roles.remove(quarantineRole).catch(() => {});
      await message.reply(`✅ <@${userId}> approved and whitelisted from future flags.`);
      break;
    }

    // ── !sec help ──
    case 'help':
    default: {
      const embed = new EmbedBuilder()
        .setColor(0x00e5ff)
        .setTitle('// AIBORGZ SECURITY — COMMANDS //')
        .setDescription('All commands require **Ban Members** permission.')
        .addFields(
          { name: `\`${PREFIX} stats\``, value: 'Show security statistics', inline: false },
          { name: `\`${PREFIX} recent\``, value: 'Show recent flagged joins', inline: false },
          { name: `\`${PREFIX} bans\``, value: 'Show tracked ban list', inline: false },
          { name: `\`${PREFIX} check <userId>\``, value: 'Manually check a member', inline: false },
          { name: `\`${PREFIX} addban <userId>\``, value: 'Manually add a user to ban tracking', inline: false },
          { name: `\`${PREFIX} removeban <userId>\``, value: 'Remove a user from ban tracking', inline: false },
          { name: `\`${PREFIX} approve <userId>\``, value: 'Approve a user and remove from quarantine', inline: false },
        )
        .setFooter({ text: 'AIBORGZ Security // Year 2189' });
      await message.reply({ embeds: [embed] });
      break;
    }
  }
}

module.exports = { handleCommand };
