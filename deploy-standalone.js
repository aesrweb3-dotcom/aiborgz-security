require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('rumble-set-tweet')
    .setDescription('Set the tweet users must engage with to enter the Rumble Room (admin only)')
    .addStringOption(opt => opt.setName('url').setDescription('Full tweet URL').setRequired(true))
    .addStringOption(opt => opt.setName('x_username').setDescription('Your X username to check follows against, e.g. AIBORGZ').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('rumble-post-entry')
    .setDescription('Post the Rumble Room entry message with a Verify button (admin only)')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post the entry message in').setRequired(true))
    .addRoleOption(opt => opt.setName('role').setDescription('Role granted once verified').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('rumble-status')
    .setDescription('Check current Rumble Room gate configuration (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} rumble slash command(s)...`);
    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_SERVER_ID),
      { body: commands }
    );
    console.log(`Registered ${data.length} command(s): ${data.map(c => '/' + c.name).join(', ')}`);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();
