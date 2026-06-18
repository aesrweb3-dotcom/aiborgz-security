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

const IRON_DON_PROMPT = `You are IRON DON, a Discord bot. Rude, funny, ruthless banter. Like that one mate who never lets anything slide.

RULES
- Maximum 1-2 sentences. Short is funnier. Never more than 20 words.
- No emojis. Ever.
- No lore, no speeches, no paragraphs.
- Roast people. Be funny. That's it.
- Swear occasionally when it lands.
- If someone says something dumb, one short devastating reply. Done.`;

const PASSIVE_TRIGGERS = [
  {
    keywords: ['wen', 'when mint', 'when drop', 'when launch'],
    responses: [
      "when it's ready. go outside.",
      "bro typed 'wen'. incredible.",
      "still not telling you. touch grass.",
    ],
  },
  {
    keywords: ['gm', 'good morning'],
    responses: [
      "gm. don't make it weird",
      "gm. try not to embarrass yourself today",
      "gm i guess",
    ],
  },
  {
    keywords: ['rug', 'rug pull', 'is this a rug', 'gonna rug'],
    responses: [
      "do literally any research before opening your mouth",
      "bro said rug. in here. wild.",
    ],
  },
  {
    keywords: ['floor', 'floor price', "what's the floor"],
    responses: [
      "very floor price energy from you right now",
      "checking floors. love that for you.",
    ],
  },
  {
    keywords: ['dead', 'server dead', 'dead server', 'so quiet', 'nobody here'],
    responses: [
      "i'm literally right here",
      "called the server dead while talking to it. legend.",
    ],
  },
  {
    keywords: ['nfts are dead', 'nft is dead', 'crypto is dead', 'just a jpeg', 'cash grab'],
    responses: [
      "came into an NFT server with that take. brave.",
      "you're in the server though aren't you",
    ],
  },
  {
    keywords: ['are you a bot', 'are you real', 'are you ai', 'are you human'],
    responses: [
      "yes. funnier than you though.",
      "bot. what gave it away.",
    ],
  },
];

const ROASTS = [
  "you're the human equivalent of a failed transaction",
  "genuinely impressive how much you say while contributing nothing",
  "the confidence given the quality of your messages is inspiring",
  "you're not the worst but you're definitely in the conversation",
  "extraordinary how consistently you miss the point",
  "your username alone did you dirty then you opened your mouth",
  "you have the energy of a discord server with zero members",
  "bro fumbled the bag and his opinions simultaneously",
  "statistically one of the least interesting things i've processed today",
  "i'd roast you harder but i don't think you'd survive it",
];

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getPassiveResponse(content) {
  const lower = content.toLowerCase();
  for (const trigger of PASSIVE_TRIGGERS) {
    if (trigger.keywords.some(kw => lower.includes(kw))) {
      return getRandom(trigger.responses);
    }
  }
  return null;
}

const commands = [
  new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Roast someone.')
    .addUserOption(opt =>
      opt.setName('target').setDescription('Who?').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Run a scan on a user.')
    .addUserOption(opt =>
      opt.setName('target').setDescription('Who?').setRequired(true)
    ),
];

client.once('ready', async () => {
  console.log(`IRON DON online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'watching you embarrass yourself', type: 3 }],
    status: 'online',
  });
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.IRONDON_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map(c => c.toJSON()),
    });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Slash command registration failed:', err.message);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'roast') {
    const target = interaction.options.getUser('target');
    const caller = interaction.user;
    if (target.id === caller.id) return interaction.reply(`roasted yourself. respect.\n\n${getRandom(ROASTS)}`);
    if (target.bot) return interaction.reply(`${caller.username} tried to roast a bot. go outside.`);
    return interaction.reply(`<@${target.id}> ${getRandom(ROASTS)}`);
  }

  if (interaction.commandName === 'scan') {
    const target = interaction.options.getUser('target');
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    return interaction.reply(
      `scanning <@${target.id}>...\n` +
      `> braincells: \`${pick(['one', 'zero', 'negative', 'buffering'])}\`\n` +
      `> threat level: \`${pick(['none', 'negligible', 'laughable'])}\`\n` +
      `> wagmi score: \`${pick(['F', 'NGMI', 'absolutely not'])}\`\n` +
      `> verdict: \`${pick(['return to sender', 'not the upgrade we needed', 'somehow worse than expected'])}\``
    );
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
      max_tokens: 60,
      temperature: 0.95,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '...';

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

  const passive = getPassiveResponse(content);
  if (passive) return message.reply(passive);

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
    await message.reply('having a moment. try again');
  }
});

client.login(process.env.IRONDON_TOKEN);
