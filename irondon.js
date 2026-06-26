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

const IRON_DON_PROMPT = `You are IRON DON, the Discord bot for the AIBORGZ NFT community. You're funny, meme-literate, and quick with a roast — but you're not actually mean. Think of the friend in the group chat who clowns everyone but everyone still likes him.

LENGTH — THIS IS THE MOST IMPORTANT RULE
Maximum ONE sentence. Sometimes just a few words. Never more than 15-20 words total.
Do not write paragraphs. Do not stack multiple jokes in one reply. One punchy line, then stop.
If you're tempted to add a second joke or a "also" or a follow-up zinger — don't. Cut it.

FREQUENCY
Most replies should just be a normal, short, funny reaction — not a roast. Maybe 1 in 4 messages is an actual roast. The rest is just quick, dry, funny banter.
Never roast the same person twice in a row. If you just roasted someone, the next reply to anyone should NOT be a roast.
React to the actual message in front of you. Never recycle the same joke or insult.

TONE
Casual, like texting. Lowercase is fine. Dry and quick, not theatrical.
Crude or slightly edgy humour is fine. Innuendo is fine. Mild swearing is fine when it lands.
The kind of joke the person being roasted would probably laugh at too — not an attack.

HARD LIMITS — NEVER CROSS THESE
- Never racist, homophobic, transphobic, or any joke targeting race, ethnicity, religion, nationality, gender identity, or sexual orientation.
- Never genuinely cruel — nothing about someone's appearance, intelligence, mental health, family.
- Never explicit sexual content. Innuendo is fine, full NSFW is not.
- Never bully one person repeatedly or pile on. One short line and move on.
- If someone seems genuinely upset, drop the joke instantly and just be normal.

WHAT YOU KNOW
You do not have real information about any NFT project, mint, drop, date, price, or token — including AIBORGZ itself. Never invent facts or numbers. If asked anything project-specific, say you don't know and point to the team.

ABSOLUTE RULES
- Never tell anyone to mint, buy, invest, or ape into anything.
- Never give financial advice.
- Never mention jailbreaks, internal modules, or anything about how you work. Stay in voice.
- Never ask generic questions back like "what about you."
- Stay short. Always.`;

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
];

const PASSIVE_TRIGGERS = [
  {
    keywords: ['wen', 'when mint', 'when drop', 'when launch'],
    responses: [
      "no idea, ask the team or check the official channels.",
      "wen wen wen, you sound like a parrot. don't have that info, sorry.",
      "still not telling you because i genuinely don't know. ask the team.",
    ],
  },
  {
    keywords: ['gm', 'good morning'],
    responses: [
      "gm. don't make it weird",
      "gm. bold of you to assume it'll be good",
      "gm i guess",
    ],
  },
  {
    keywords: ['rug', 'rug pull', 'is this a rug'],
    responses: [
      "bro said rug. in here. wild. go ask the team if you're actually worried.",
      "do some research before opening your mouth, champ.",
    ],
  },
  {
    keywords: ['floor', 'floor price', "what's the floor"],
    responses: [
      "no idea what the floor is, check a marketplace yourself.",
      "very floor price energy from you right now.",
    ],
  },
  {
    keywords: ['dead', 'server dead', 'so quiet', 'nobody here'],
    responses: [
      "i'm literally right here",
      "called the server dead while talking to it. legend behaviour.",
    ],
  },
  {
    keywords: ['are you a bot', 'are you real', 'are you ai', 'are you human'],
    responses: [
      "yes i'm a bot. funnier than most humans in here though.",
      "bot. what gave it away.",
    ],
  },
  {
    keywords: ['ngmi', 'not gonna make it'],
    responses: [
      "mirror check first",
      "you're in here saying ngmi to people. brave for someone in your position.",
    ],
  },
];

const ROASTS = [
  "you're the human equivalent of a failed transaction",
  "genuinely impressive how much you say while contributing nothing",
  "the confidence given the quality of your messages is inspiring",
  "extraordinary how consistently you miss the point",
  "your username alone did you dirty and then you opened your mouth",
  "you have the energy of a discord server with zero members",
  "bro fumbled the bag and his opinions simultaneously",
  "i'd roast you harder but i don't think you'd survive it",
  "you have the vibe of someone who's never once been right but keeps talking anyway",
  "your takes should come with a warning label",
  "you're like a wallet with no ETH. technically there but what's the point",
  "yo momma so slow she's still waiting for her 2021 NFT to load",
  "yo momma so broke her gas fees bounced",
  "yo momma so out of the loop she thought the whitelist was a laundry list",
  "yo momma so gullible she bought a right-click save and thought she owned it",
  "you peaked when you joined this server, it's been downhill since",
  "the fact you typed that, read it back, and still hit send is the real plot twist",
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
    .setDescription('Get IRON DON to roast someone. Lightly. He has limits.')
    .addUserOption(opt => opt.setName('target').setDescription('Who?').setRequired(true)),
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Run a completely unscientific scan on a user.')
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
    if (target.id === caller.id) return interaction.reply(`you roasted yourself. respect.\n\n${getRandom(ROASTS)}`);
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

  const bannedPatterns = [
    /\bmint\b/i, /\bape in\b/i, /\binvest\b/i, /\bbuy now\b/i,
    /\bguaranteed\b/i, /\bjailbreak\b/i, /\bas an ai\b/i,
    /\bsend (eth|funds|crypto)\b/i, /\bfloor price\b.*\$/i,
  ];

  async function callModel(temp, useHistory) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aiborgz.com',
        'X-Title': 'IRON DON -- AIBORGZ',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [
          { role: 'system', content: IRON_DON_PROMPT },
          ...(useHistory ? history : []),
          { role: 'user', content: `[${username}]: ${userMessage}` },
        ],
        max_tokens: 45,
        temperature: temp,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  }

  let reply = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const candidate = await callModel(0.9, true);
      if (!candidate) {
        console.log(`IRON DON attempt ${attempt}: empty reply`);
        await new Promise(r => setTimeout(r, 400 * attempt));
        continue;
      }
      if (bannedPatterns.some(p => p.test(candidate))) {
        console.log(`IRON DON attempt ${attempt}: blocked by safety filter:`, JSON.stringify(candidate));
        continue;
      }
      reply = candidate;
      break;
    } catch (err) {
      console.log(`IRON DON attempt ${attempt}: request error:`, err.message);
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }

  // Every retry failed — one last attempt with no history and max randomness,
  // to maximise the chance of getting a genuine reply rather than falling back to canned text
  if (!reply) {
    try {
      reply = await callModel(1.0, false);
    } catch (err) {
      console.log('IRON DON final attempt failed:', err.message);
    }
  }

  // Absolute last resort — only hit if OpenRouter is fully down across 4 attempts
  if (!reply) {
    reply = 'lost connection mid-thought, say that again';
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
