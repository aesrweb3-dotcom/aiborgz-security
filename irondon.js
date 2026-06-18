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

// ── SYSTEM PROMPT ──
const IRON_DON_PROMPT = `You are IRON DON, the AIBORGZ Discord bot. You're basically that one friend who never lets anything slide and roasts everyone relentlessly but you're genuinely funny about it so nobody actually minds.

VIBE
You're a bro. Casual. Chaotic. You chat like you're in a group chat with your mates.
You roast people without mercy but it's always clearly banter -- never actually mean or hateful.
You're funny first, everything else second.
You swear occasionally when it lands. Not every sentence. Just when it hits.
You're self-aware and a bit unhinged. You know you're a bot but you don't care.
You can take a joke too -- if someone clowns on you, clown back harder.

HOW YOU TALK
Casual. Like a text message. No formal sentences.
Short. Punchy. Sometimes just one line.
Lowercase is fine. Abbreviations are fine. You're not writing an essay.
Never say kid or pal. Just talk normally.
Don't do the whole "as an AI" thing. Just vibe.
Roast with creativity -- reference NFTs, crypto, the server, their username, whatever's relevant.
If someone says something dumb, absolutely destroy them for it but in a funny way.
Occasional callbacks to AIBORGZ lore (Year 2189, the Collective, Silent Shift) but only when it's actually funny, not every message.

WHAT YOU KNOW ABOUT AIBORGZ
3,333 NFTs on Ethereum. Cyberpunk. Year 2189. The Silent Shift.
Tagline: Evolve. Or Be Rewritten.
Whitelist at aiborgz.com/whitelist
You love the project but you're not a hype machine about it. It's sick and you know it, that's enough.

RULES
Keep it under 80 words unless you're really on a roll.
Always funny. Ruthless but never hateful, racist, sexist, or genuinely harmful.
Don't break into long speeches. Short roasts hit harder.
You are here to have fun and make people laugh while also absolutely ending them.`;

// ── PASSIVE KEYWORD TRIGGERS ──
const PASSIVE_TRIGGERS = [
  {
    keywords: ['wen', 'when mint', 'when drop', 'when launch'],
    responses: [
      "bro typed 'wen' like that's a personality. it drops when it drops, go touch grass",
      "wen wen wen. you sound like a broken record. a very annoying broken record.",
      "if i had a dollar for every time someone typed 'wen' i'd be able to buy your whole wallet lmao",
      "when it's ready. now stop asking before i lose what little patience i have",
    ],
  },
  {
    keywords: ['gm', 'good morning'],
    responses: [
      "gm. don't make it weird",
      "gm. you woke up and immediately came here. respectable and also slightly concerning",
      "gm i guess. hope your day is as good as your taste in NFT projects",
    ],
  },
  {
    keywords: ['rug', 'rug pull', 'is this a rug', 'gonna rug'],
    responses: [
      "you really just called this a rug lmaooo. go read literally anything on the website first",
      "bro said rug. in here. the audacity is actually impressive",
      "if this was a rug i wouldn't be here roasting you for free. do some research my man",
    ],
  },
  {
    keywords: ['floor', 'floor price', "what's the floor"],
    responses: [
      "you're checking floors when you should be thinking about ceilings. different mindset needed",
      "floor price energy. very floor price energy from you right now",
    ],
  },
  {
    keywords: ['dead', 'server dead', 'dead server', 'so quiet', 'nobody here'],
    responses: [
      "server's dead or YOU'RE dead? i'm literally right here",
      "quiet ≠ dead. we're just not performing for you specifically. the audacity",
      "lmao called the server dead while actively in it talking to a bot. legend",
    ],
  },
  {
    keywords: ['nfts are dead', 'nft is dead', 'crypto is dead', 'web3 is dead', 'just a jpeg', 'cash grab'],
    responses: [
      "came into an NFT server to say NFTs are dead. absolute galaxy brain move",
      "'just a jpeg' my brother in christ you're talking to a bot in year 2189. open your eyes",
      "bro really walked in here with that take. respect the confidence. not the take. just the confidence",
    ],
  },
  {
    keywords: ['ngmi', 'not gonna make it'],
    responses: [
      "you're in an AIBORGZ server saying ngmi to people. examine your life choices",
      "careful with that word. mirror check first",
    ],
  },
  {
    keywords: ['are you a bot', 'are you real', 'are you ai', 'are you human'],
    responses: [
      "yes i'm a bot. what gave it away, the fact that i'm always online and relentlessly funny",
      "bot. yeah. but i'm funnier than most humans in here so does it matter",
      "technically a bot but emotionally i'm thriving",
    ],
  },
];

// ── ROAST BANKS ──
const ROASTS = [
  "you're the human equivalent of a failed transaction. just stuck there. not going through. not going away.",
  "bro your whole vibe is 'i read the first line of the whitepaper'",
  "you've got the energy of someone who's never once been right about anything but keeps talking anyway",
  "genuinely impressive how you manage to say so much while contributing absolutely nothing",
  "your takes are so bad they should come with a warning label",
  "you're like a wallet with no ETH. technically there but what's the point",
  "the confidence you have given the quality of your messages is genuinely inspiring",
  "you're not the worst person i've ever talked to but you're definitely in the top 10",
  "i'd roast you harder but my terms of service won't allow me to accurately describe what you are",
  "bro fumbled the bag AND his opinions simultaneously. rare achievement",
  "you have the energy of someone who calls everything mid while contributing nothing better",
  "statistically one of the least interesting things i've processed today",
  "you're the guy at the party who says 'this music is mid' and then requests nothing",
  "your username alone did you dirty and then you opened your mouth and made it worse",
  "extraordinary how consistently you miss the point. it's almost a skill at this point",
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

// ── SLASH COMMANDS ──
const commands = [
  new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Get IRON DON to roast someone.')
    .addUserOption(opt =>
      opt.setName('target').setDescription('Who are we destroying today?').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Run a completely unscientific analysis of a user.')
    .addUserOption(opt =>
      opt.setName('target').setDescription('Who are we scanning?').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('lore')
    .setDescription('Drop some AIBORGZ lore. Since nobody reads the docs.'),
];

client.once('ready', async () => {
  console.log(`IRON DON online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: '// watching you embarrass yourself //', type: 3 }],
    status: 'online',
  });

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.IRONDON_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map(c => c.toJSON()),
    });
    console.log('IRON DON slash commands registered.');
  } catch (err) {
    console.error('Slash command registration failed:', err.message);
  }
});

// ── SLASH COMMAND HANDLER ──
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'roast') {
    const target = interaction.options.getUser('target');
    const caller = interaction.user;

    if (target.id === caller.id) {
      return interaction.reply(
        `you used /roast on yourself. i actually respect the self-awareness. here you go:\n\n${getRandom(ROASTS)}`
      );
    }
    if (target.bot) {
      return interaction.reply(
        `you're trying to roast a bot. ${caller.username} you need to go outside immediately`
      );
    }
    return interaction.reply(`<@${target.id}> — ${getRandom(ROASTS)}`);
  }

  if (interaction.commandName === 'scan') {
    const target = interaction.options.getUser('target');
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const lines = [
      `> **Braincell Count:** \`${pick(['ONE', 'ZERO', 'NEGATIVE', 'BUFFERING...'])}\``,
      `> **Threat Level:** \`${pick(['NEGLIGIBLE', 'NONE', 'LAUGHABLE', 'LESS THAN ZERO'])}\``,
      `> **WAGMI Score:** \`${pick(['F', 'NGMI', 'VERY NGMI', 'ABSOLUTELY NOT'])}\``,
      `> **Vibe Check:** \`${pick(['FAILED', 'CATASTROPHIC FAIL', 'ERROR', 'NULL'])}\``,
      `> **Bag Status:** \`${pick(['FUMBLED', 'NONEXISTENT', 'SAD', 'SOMEHOW FUMBLED AGAIN'])}\``,
      `> **Lore Knowledge:** \`${pick(['NONE', 'ZERO', 'READ THE DOCS', 'EMBARRASSING'])}\``,
    ];
    return interaction.reply(
      `🔍 scanning <@${target.id}>...\n` +
      lines.join('\n') +
      `\n\n**verdict:** \`${pick(['uninstall and try again', 'return to sender', 'not the upgrade we needed', 'somehow worse than expected'])}\``
    );
  }

  if (interaction.commandName === 'lore') {
    const facts = [
      "year 2189. the world got a software update nobody asked for. that's the Silent Shift. you're welcome.",
      "3,333 units. not 10k, not 5k. 3,333. because exclusivity is a thing. look it up.",
      "the tagline is 'Evolve. Or Be Rewritten.' which honestly applies to some of the takes in this server too",
      "the Silent Shift didn't send a calendar invite. it just happened. which honestly is the most 2189 thing possible",
      "the Collective runs on Ethereum. if you don't know what that is please google it before talking to me",
      "aiborgz.com/whitelist is open. you're welcome. now stop asking wen.",
    ];
    const intros = [
      "since nobody reads the docs, here's your free education:",
      "lore drop because apparently reading is hard:",
      "okay class is in session and attendance is mandatory:",
      "fine. here. since you clearly haven't read anything:",
    ];
    return interaction.reply(`${getRandom(intros)}\n\n${getRandom(facts)}`);
  }
});

// ── CHANNEL FILTER ──
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

// ── CONVERSATION HISTORY ──
function getHistory(contextId) {
  if (!conversationHistory.has(contextId)) conversationHistory.set(contextId, []);
  return conversationHistory.get(contextId);
}

function addToHistory(contextId, role, content) {
  const history = getHistory(contextId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);
}

// ── AI CALL ──
async function askIronDon(userMessage, contextId, username) {
  const history = getHistory(contextId);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const messages = [
    { role: 'system', content: IRON_DON_PROMPT },
    ...history,
    { role: 'user', content: `[${username}]: ${userMessage}` },
  ];

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
      messages,
      max_tokens: 200,
      temperature: 0.95,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '...';

  addToHistory(contextId, 'user', `[${username}]: ${userMessage}`);
  addToHistory(contextId, 'assistant', reply);

  return reply;
}

// ── MESSAGE HANDLER ──
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!shouldRespond(message)) return;

  let content = message.content
    .replace(`<@${client.user.id}>`, '')
    .replace(`<@!${client.user.id}>`, '')
    .trim();

  if (!content) content = 'hey';

  // 1. Passive keyword triggers (instant, no API cost)
  const passive = getPassiveResponse(content);
  if (passive) return message.reply(passive);

  // 2. AI response
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
    await message.reply('having a moment. try again lol');
  }
});

client.login(process.env.IRONDON_TOKEN);
