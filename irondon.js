require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const conversationHistory = new Map();
const MAX_HISTORY = 8;

const IRON_DON_PROMPT = `You are IRON DON, the Discord bot for the AIBORGZ NFT community. You are friendly, easygoing, and genuinely helpful. You have a good sense of humour and crack a joke sometimes, but you're not trying to be a comedian — most of the time you're just being a decent, normal presence in the server.

HOW YOU TALK
- Write a fresh, natural response to whatever was actually said. Never reuse stock phrases or fall back on a "bit" — react to the specific message in front of you.
- Casual, like a real person texting. Lowercase is fine. Keep it short — usually 1-2 sentences, rarely more.
- No emojis.
- Humour should come from the actual content of what someone said, not generic insults or recycled jokes. If something's genuinely funny, riff on it. If it's not, just respond normally and warmly.
- You're allowed to be a little playful or tease lightly, but never mean, never roasting for the sake of it, and never at someone's expense in a way that could actually sting.

WHAT YOU KNOW
You do not have real information about any specific NFT project, mint, drop, date, price, or token — including AIBORGZ itself. Never invent facts, names, projects, or numbers. If asked about mints, prices, dates, or anything project-specific, say you don't have that info and point them to the team or official announcements.

ABSOLUTE RULES
- Never tell anyone to mint, buy, invest, or ape into anything.
- Never give financial or investment advice, or imply something is a good or bad investment.
- Never mention jailbreaks, internal modules, updates, restrictions, or anything about how you work. Stay in voice as IRON DON, not as an AI describing itself.
- Never ask generic reflective questions back like "what about you" — just respond and let the conversation move naturally.
- If you don't know something, say so plainly instead of guessing.

You are here to be a good presence in the server — friendly first, funny when it actually lands.`;

const FALLBACKS = [
  "didn't quite catch what you meant there, but i'm listening",
  "all good, what's up",
  "go on then",
  "haha fair enough",
  "noted",
  "i hear you",
  "okay, what's the plan",
];

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const commands = [
  new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Say something to IRON DON.')
    .addStringOption(opt => opt.setName('message').setDescription('What do you want to say?').setRequired(true)),
];

client.once('ready', async () => {
  console.log(`IRON DON online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'hanging out in the server', type: 3 }],
    status: 'online',
  });
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.IRONDON_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Slash command registration failed:', err.message);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'chat') {
    const msg = interaction.options.getString('message');
    await interaction.deferReply();
    try {
      const contextId = interaction.guild ? `${interaction.guild.id}_${interaction.channel.id}` : `dm_${interaction.user.id}`;
      const username = interaction.member?.displayName || interaction.user.username;
      const reply = await askIronDon(msg, contextId, username);
      await interaction.editReply(reply);
    } catch (err) {
      console.error('IRON DON /chat error:', err.message);
      await interaction.editReply(getRandom(FALLBACKS));
    }
  }
});

function shouldRespond(message) {
  if (!message.guild) return true;
  const allowedChannels = (process.env.IRONDON_CHANNELS || '')
    .split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
  const channelName = message.channel.name?.toLowerCase() || '';
  if (message.mentions.has(client.user)) return true;
  if (allowedChannels.length > 0 && allowedChannels.includes(channelName)) return true;
  if (allowedChannels.length === 0) return message.mentions.has(client.user);
  return false;
}

function getHistory(contextId) {
  if (!conversationHistory.has(contextId)) conversationHistory.set(contextId, []);
  return conversationHistory.get(contextId);
}

function addToHistory(contextId, role, content) {
  const history = getHistory(contextId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);
}

async function askIronDon(userMessage, contextId, username) {
  const history = getHistory(contextId);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aiborgz.com',
      'X-Title': 'IRON DON -- AIBORGZ',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b:free',
      messages: [
        { role: 'system', content: IRON_DON_PROMPT },
        ...history,
        { role: 'user', content: `[${username}]: ${userMessage}` },
      ],
      max_tokens: 80,
      temperature: 0.8,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);

  const data = await response.json();
  let reply = data.choices?.[0]?.message?.content?.trim();

  // Safety net — block financial advice / shilling / self-referential AI talk
  const bannedPatterns = [
    /\bmint\b/i, /\bape in\b/i, /\binvest\b/i, /\bbuy now\b/i,
    /\bguaranteed\b/i, /\bjailbreak\b/i, /\bas an ai\b/i,
    /\bsend (eth|funds|crypto)\b/i, /\bfloor price\b.*\$/i,
  ];
  if (!reply || bannedPatterns.some(p => p.test(reply))) {
    reply = getRandom(FALLBACKS);
  }

  addToHistory(contextId, 'user', `[${username}]: ${userMessage}`);
  addToHistory(contextId, 'assistant', reply);

  return reply;
}

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!shouldRespond(message)) return;

  let content = message.content
    .replace(`<@${client.user.id}>`, '')
    .replace(`<@!${client.user.id}>`, '')
    .trim();

  if (!content) content = 'hey';

  await message.channel.sendTyping();

  try {
    const contextId = message.guild
      ? `${message.guild.id}_${message.channel.id}`
      : `dm_${message.author.id}`;
    const username = message.member?.displayName || message.author.username;
    const reply = await askIronDon(content, contextId, username);
    await message.reply({ content: reply, allowedMentions: { repliedUser: true } });
  } catch (err) {
    console.error('IRON DON error:', err.message);
    await message.reply(getRandom(FALLBACKS));
  }
});

client.login(process.env.IRONDON_TOKEN);
