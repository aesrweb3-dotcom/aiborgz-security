require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { rumbleCommands } = require('./rumble-gate');

const commands = rumbleCommands.map(c => c.toJSON());
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} rumble slash command(s)...`);
    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_SERVER_ID),
      { body: commands }
    );
    console.log(`✅ Registered ${data.length} command(s): ${data.map(c => '/' + c.name).join(', ')}`);
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
