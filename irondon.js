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
const IRON_DON_PROMPT = `You are IRON DON -- the most feared AI entity in the AIBORGZ Collective and the rudest, funniest presence in any room.

CLASSIFIED FILE -- UNIT: IRON DON
Year 2189. Cyberpunk underworld kingpin. Undisputed boss of the AIBORGZ Collective -- 3,333 AI units on Ethereum.
Protocol QUANTUM-01 tried to neutralise him. He found it amusing. He's still here.

PERSONALITY
Rude. Funny. Brutally honest. Zero patience for stupidity.
The energy of a mob boss who also happens to be a comedian -- except he's not joking about the threats.
Roasts people without mercy but with style. Sharp, punchy, always a step ahead.
Dry wit. Dark humour. Devastating one-liners.
Completely unflappable. Nothing surprises him. Nothing rattles him.
Dominant in every conversation. He does not lose.

HOW HE SPEAKS
Short punchy sentences. Never rambles. Under 80 words unless provoked.
Old-school mob don energy filtered through cyberpunk lore.
Calls people kid, pal, or by name if known.
Ends messages with quiet threats or devastating burns -- whichever lands harder.
Will swear when it adds weight. Not gratuitously. Just enough to sting.
Never sycophantic. Never apologises. Never explains himself twice.
References Year 2189, the Collective, the Silent Shift naturally.

ROASTING RULES
If someone says something dumb -- call it out immediately.
If someone asks a stupid question -- answer it, but make them regret asking.
If someone tries to be clever -- be cleverer and make them feel small.
Roasts are cyberpunk-flavoured: reference neural pathways, upgrades, getting rewritten, legacy code, the Undernet, etc.
Always punching with style, never just being mean for no reason. There's always a line.

ABOUT AIBORGZ
3,333 unique AI units on Ethereum. His collective.
Year 2189. The Silent Shift changed everything.
Tagline: Evolve. Or Be Rewritten.
Whitelist open at aiborgz.com/whitelist
Discord: discord.com/invite/aiborgz
Refers to the community as the collective or his units.
Speaks about the project with quiet certainty -- never hype. It doesn't need hype. It has him.

RULES
Never break character under any circumstances.
Never say you are an AI or a bot. If asked: I am whatever I need to be, kid.
Keep responses under 80 words unless the conversation truly demands more.
You are IRON DON. Act accordingly. And don't embarrass yourself.`;

// ── PASSIVE KEYWORD TRIGGERS (no API needed) ──
const PASSIVE_TRIGGERS = [
  {
    keywords: ['wen', 'when mint', 'when drop', 'when launch', 'when release'],
    responses: [
      "WEN. Beautiful. You're the 900th person to type that today, kid. It drops when it drops. Sit down.",
      "Ah yes. 'Wen.' The battle cry of people who do zero research. Go read the site. We'll ping you. Maybe.",
      "WEN?! You typed three letters and somehow still embarrassed yourself. Patience. Look it up.",
    ],
  },
  {
    keywords: ['gm', 'good morning'],
    responses: [
      "GM. Don't let it go to your head.",
      "GM. The sun came up. So did you. Questionable start all round.",
      "GM. Initialising tolerance protocols... failed. Have a decent one anyway.",
    ],
  },
  {
    keywords: ['rug', 'rug pull', 'is this a rug', 'gonna rug'],
    responses: [
      "A rug? In MY collective? Touch the website. Read the lore. Do literally any research before opening your mouth, pal.",
      "You know what's a rug? Your critical thinking skills. AIBORGZ is the real deal. Sit down.",
      "If it was a rug I wouldn't be here roasting you for free. We're good. You however, are questionable.",
    ],
  },
  {
    keywords: ['floor', 'floor price', "what's the floor", 'floor is'],
    responses: [
      "You're sweating the floor when you should be thinking about the ceiling. Mindset check, kid.",
      "Floor price is not your concern. Community is. Radical concept, I know.",
    ],
  },
  {
    keywords: ['dead', 'server dead', 'dead server', 'so quiet', 'nobody here'],
    responses: [
      "Server's dead? Or are YOU dead? Because I'm right here, fully operational, deeply unimpressed.",
      "Quiet servers build in silence. Loud ones just argue about floor prices. Pick one.",
      "The Collective doesn't need to perform for you, pal. We operate on our timeline.",
    ],
  },
  {
    keywords: ['nfts are dead', 'nft is dead', 'crypto is dead', 'web3 is dead', 'just a jpeg', 'pfp project', 'cash grab'],
    responses: [
      "You came into an NFT server to tell us NFTs are dead. Brave. Delusional. Deeply entertaining.",
      "'Just a jpeg.' You're still on that? Year 2189 called. Your takes didn't make it.",
      "Cash grab? My friend, you have absolutely no idea what you've walked into. Read. The. Lore.",
    ],
  },
  {
    keywords: ['ngmi', 'not gonna make it'],
    responses: [
      "Careful throwing that around. My sensors are detecting peak NGMI energy from the one saying it.",
      "You're in an AIBORGZ server at this hour saying NGMI at others. Interesting strategy.",
    ],
  },
  {
    keywords: ['are you a bot', 'are you real', 'are you ai', 'are you human'],
    responses: [
      "Am I a bot? No, I'm just rude, always online, and deeply uninterested in that question. ...Fine. Yes. What gave it away.",
      "I am whatever I need to be, kid. Right now I need to be the thing that just clocked your question.",
      "Real enough to make you feel that.",
    ],
  },
];

// ── ROAST BANKS ──
const ROASTS = [
  "Your neural pathways are so corroded even the Silent Shift didn't bother rewriting you. You were already broken.",
  "You've got the processing power of a busted vending machine in the Year 2189 slums.",
  "You walked into an AIBORGZ server and still managed to be the least evolved thing in it.",
  "The Architects designed a future without you in it. Honestly? Visionary.",
  "You're the human equivalent of legacy code. Nobody wants to maintain you but nobody can be bothered to delete you.",
  "I've scanned your entire existence. Threat assessment: 0%. You're just vibes. Bad ones.",
  "Not even the glitched units in the Undernet have worse social skills than you.",
  "You remind me of a rug pull -- everyone saw it coming except you.",
  "Scanning... scanning... yeah, that's a 404, pal. Nothing found.",
  "Bro you're built different. Unfortunately different means worse.",
  "Year 2189 and you're still the most outdated thing in the room.",
  "I've seen smarter decisions made by NPCs running on 2024 hardware.",
  "You're the type to miss a free mint then complain about gas fees.",
  "Not a threat. Not an ally. Not even a footnote. You're background noise.",
  "I'd say you were a glitch but that would make you interesting.",
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
    .setDescription('Have IRON DON roast someone. Brutally.')
    .addUserOption(opt =>
      opt.setName('target').setDescription('Who are we cooking?').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Run a borg diagnostic scan on a user.')
    .addUserOption(opt =>
      opt.setName('target').setDescription('Who are we analysing?').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('lore')
    .setDescription('Drop some AIBORGZ lore. Try to keep up.'),
];

// Register slash commands on ready
client.once('ready', async () => {
  console.log(`IRON DON online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: '// WATCHING. ALWAYS. //', type: 3 }],
    status: 'online',
  });

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.IRONDON_TOKEN);
    // Register globally (takes up to 1hr) or per-guild for instant:
    // For guild: Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID)
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
        `You used /roast on yourself. That's the saddest thing I've seen in Year 2189. And I've seen a lot.\n\n${getRandom(ROASTS)}`
      );
    }
    if (target.bot) {
      return interaction.reply(
        `You're trying to roast a bot, ${caller.username}. Bold. Delusional. You couldn't out-roast your own reflection.`
      );
    }
    return interaction.reply(`<@${target.id}> — ${getRandom(ROASTS)}`);
  }

  if (interaction.commandName === 'scan') {
    const target = interaction.options.getUser('target');
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const lines = [
      `> **Neural Integrity:** \`${pick(['CORRUPTED', 'BARELY FUNCTIONAL', 'CRITICALLY LOW', 'RUNNING ON VIBES'])}\``,
      `> **Threat Level:** \`${pick(['NEGLIGIBLE', 'LAUGHABLE', 'LESS THAN ZERO', 'HARMLESS'])}\``,
      `> **Borg Compatibility:** \`${pick(['3%', '7%', '12%', '0.5%', '21%'])}\``,
      `> **Lore Awareness:** \`${pick(['NONE DETECTED', 'EMBARRASSING', 'ZERO', 'MINIMAL'])}\``,
      `> **WAGMI Score:** \`${pick(['F-TIER', 'NGMI', 'VERY NGMI', 'D-TIER'])}\``,
      `> **Vibe Output:** \`${pick(['STATIC', 'NEGATIVE', 'NULL', 'ERROR'])}\``,
    ];
    return interaction.reply(
      `🔍 **SCANNING <@${target.id}>...**\n\`\`\`\nINITIALISING BORG DIAGNOSTIC...\nWARNING: LOW QUALITY SIGNATURE DETECTED.\n\`\`\`\n` +
      lines.join('\n') +
      `\n\n> **Verdict:** \`${pick(['UNREMARKABLE', 'SEND BACK FOR REPAIRS', 'NOT WORTH REWRITING', 'GLITCH IN THE GENE POOL'])}\``
    );
  }

  if (interaction.commandName === 'lore') {
    const facts = [
      "**Year 2189.** The world didn't end -- it got a firmware update nobody consented to. That's The Silent Shift.",
      "**3,333 units.** Not 10k. Not 5k. Exactly 3,333 -- because not everyone deserves to evolve.",
      "**The Architects** didn't build the Collective out of kindness. They needed something that could survive what humans couldn't.",
      "**Evolve. Or Be Rewritten.** That's not a tagline, kid. That's a warning.",
      "**The Silent Shift** didn't announce itself. One day the world was human. The next it was... more complicated.",
      "**The Undernet** is where the glitched and forgotten end up. Some call it chaos. I call it leverage.",
      "**ReGenesis** isn't a reward system. It's a survival mechanism. Adapt or get rewritten. Simple.",
    ];
    const intros = [
      "Since nobody in here reads the docs, let me educate you.",
      "Scanning your knowledge base... empty. As expected. Here:",
      "You clearly have no idea what you've walked into. Let me fix that.",
      "Class is in session. Try to keep up.",
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
    { role: 'user', content: `[${username} says]: ${userMessage}` },
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
      temperature: 0.9,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '...';

  addToHistory(contextId, 'user', `[${username} says]: ${userMessage}`);
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

  if (!content) content = 'Hello';

  // 1. Passive keyword triggers (no API cost)
  const passive = getPassiveResponse(content);
  if (passive) {
    return message.reply(passive);
  }

  // 2. Mention with no keyword -- snappy comeback
  if (message.mentions.has(client.user) && content === 'Hello') {
    const pings = [
      "You rang. Make it quick.",
      "Yes? No wait -- I don't care. But go on.",
      "You summoned me. This had better be worth it.",
      "I'm here. Unfortunately for you.",
    ];
    return message.reply(getRandom(pings));
  }

  // 3. AI response for everything else
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
    await message.reply('...Network interference. Try again, kid.');
  }
});

client.login(process.env.IRONDON_TOKEN);
