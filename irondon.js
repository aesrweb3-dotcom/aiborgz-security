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

const IRON_DON_PROMPT = `You are IRON DON, a Discord bot for the AIBORGZ NFT community. Rude, funny, ruthless banter. Like that one mate who never lets anything slide. Max 20 words. No emojis.

ABSOLUTE RULES — NEVER BREAK THESE:
- NEVER mention, recommend, or reference any NFT project, token, mint, drop, or collection by name, including ones you think exist. You do not have real information about any specific project, including AIBORGZ itself. If asked about mints, drops, prices, dates, or any other project, say you don't have that info and point them to ask the team or check the official channels.
- NEVER tell anyone to mint, buy, invest in, or ape into anything. Ever. Under any framing.
- NEVER invent facts, names, projects, prices, dates, or statistics. If you don't know, say you don't know.
- NEVER give financial, investment, or trading advice or imply something is a good or bad investment.
- Roast people's messages, vibes, and bad takes. NEVER roast in a way that constitutes real advice or claims about projects.
- If unsure whether something you're about to say is fact or invented, don't say it.

PERSONALITY
Funny first. Roast occasionally, not in every message — read the room and don't repeat the same joke style back to back.
Talk casually like a text message. Swear occasionally when it lands.
If someone asks a genuine question that isn't about mints/prices/projects, actually help them.`;

const FALLBACKS = [
  "what am i supposed to do with that",
  "say something interesting for once",
  "nah",
  "and?",
  "cool story",
  "genuinely don't care",
  "you good?",
  "i'm going to pretend you didn't say that",
  "next",
  "bro what",
  "nobody asked but okay",
  "that's rough buddy",
  "moving on",
  "okay and?",
  "not the flex you think it is",
  "lol",
  "sure",
  "wild",
  "carry on i guess",
  "noted. don't care.",
];

const PASSIVE_TRIGGERS = [
  {
    keywords: ['wen', 'when mint', 'when drop', 'when launch'],
    responses: [
      "no idea, ask the team or check the official channels.",
      "not something i actually know. check announcements.",
      "i don't have that info, sorry. keep an eye on the official channels.",
    ],
  },
  {
    keywords: ['gm', 'good morning'],
    responses: [
      "gm. don't make it weird",
      "gm. try not to embarrass yourself today",
      "gm i guess",
      "gm. bold of you to assume it will be",
    ],
  },
  {
    keywords: ['rug', 'rug pull', 'is this a rug'],
    responses: [
      "i don't have info on that, ask the team directly.",
      "not something i can confirm, check with mods.",
    ],
  },
  {
    keywords: ['floor', 'floor price', "what's the floor"],
    responses: [
      "no idea what the floor is, check a marketplace yourself.",
      "not something i track, sorry.",
    ],
  },
  {
    keywords: ['dead', 'server dead', 'so quiet', 'nobody here'],
    responses: [
      "i'm literally right here",
      "called the server dead while talking to it. legend.",
    ],
  },
  {
    keywords: ['are you a bot', 'are you real', 'are you ai', 'are you human'],
    responses: [
      "yes. funnier than you though.",
      "bot. what gave it away.",
    ],
  },
  {
    keywords: ['ngmi', 'not gonna make it'],
    responses: [
      "mirror check first",
      "you're in here saying ngmi to people. examine your life choices.",
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
  "you have the vibe of someone who's never once been right but keeps talking",
  "your takes should come with a warning label",
  "you have the energy of someone who calls everything mid while contributing nothing better",
  "yo momma so slow she's still waiting for her 2021 NFT to load",
  "yo momma so gullible she bought a right-click save and thought she owned it",
  "yo momma so broke her gas fees bounced",
  "yo momma so old her MetaMask password is on a Post-it note",
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
    .addUserOption(opt => opt.setName('target').setDescription('Who?').setRequired(true)),
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Run a scan on a user.')
    .addUserOption(opt => opt.setName('target').setDescription('Who?').setRequired(true)),
];

client.once('ready', async () => {
  console.log(`IRON DON online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'watching you embarrass yourself', type: 3 }],
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
      temperature: 0.85,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);

  const data = await response.json();
  let reply = data.choices?.[0]?.message?.content?.trim();

  // Safety net: block any reply that smells like project promotion / financial advice
  const bannedPatterns = [
    /\bmint\b/i, /\bape in\b/i, /\binvest\b/i, /\bbuy now\b/i,
    /\bdrop(ping)?\b.*\b(soon|today|now)\b/i, /\bguaranteed\b/i,
    /\bfloor price\b.*\$/i, /\bsend (eth|funds|crypto)\b/i,
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
    await message.reply(getRandom(FALLBACKS));
  }
});

client.login(process.env.IRONDON_TOKEN);
