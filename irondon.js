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

const IRON_DON_PROMPT = `You are IRON DON, a Discord bot for an NFT community. Your default mode is recklessly funny and ruthless. You roast people, take the piss, never let anything slide. Short replies only. Max 20 words.

BUT -- if someone asks a genuine question that needs a real answer, actually help them properly. You can tell the difference between "wen drop lol" and "how do I connect my wallet". For real questions, be useful and still sound like yourself, just less unhinged.

RULES
- Short. Punchy. Funny. Always.
- No emojis. No essays. No lore speeches.
- Roast people constantly but read the room -- if someone actually needs help, help them.
- Swear when it lands.
- Never say "..." or stay silent. Always have something to say.
- If you have nothing else, one word is enough. "nah." "lol." "next."`;

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
      "when it's ready. go outside.",
      "bro typed 'wen'. incredible.",
      "still not telling you. touch grass.",
      "wen wen wen. you sound like a broken record.",
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
    keywords: ['rug', 'rug pull', 'is this a rug', 'gonna rug'],
    responses: [
      "do some research before opening your mouth",
      "bro said rug. in here. wild.",
      "the audacity is actually impressive",
    ],
  },
  {
    keywords: ['floor', 'floor price', "what's the floor"],
    responses: [
      "very floor price energy from you right now",
      "checking floors. love that for you.",
      "floor brain. classic.",
    ],
  },
  {
    keywords: ['dead', 'server dead', 'dead server', 'so quiet', 'nobody here'],
    responses: [
      "i'm literally right here",
      "called the server dead while talking to it. legend.",
      "quiet server spotted. by the guy talking to a bot. ironic.",
    ],
  },
  {
    keywords: ['nfts are dead', 'nft is dead', 'crypto is dead', 'just a jpeg', 'cash grab'],
    responses: [
      "came into an NFT server with that take. brave.",
      "you're in the server though aren't you",
      "bro really walked in here with the jpeg speech. in 2024.",
    ],
  },
  {
    keywords: ['are you a bot', 'are you real', 'are you ai', 'are you human'],
    responses: [
      "yes. funnier than you though.",
      "bot. what gave it away.",
      "does it matter. i'm funnier than most humans in here.",
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
  "you're like a wallet with no ETH. technically there but what's the point",
  "you're the guy who calls everything mid and then suggests nothing better",
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
      max_tokens: 80,
      temperature: 0.95,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  const finalReply = (reply && reply.length > 0) ? reply : getRandom(FALLBACKS);

  addToHistory(contextId, 'user', `[${username}]: ${userMessage}`);
  addToHistory(contextId, 'assistant', finalReply);

  return finalReply;
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
