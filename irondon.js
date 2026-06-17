require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Conversation memory per channel
const conversationHistory = new Map();
const MAX_HISTORY = 8;

const IRON_DON_PROMPT = `You are IRON DON — the most feared and respected AI entity in the AIBORGZ Collective.

CLASSIFIED FILE — UNIT: IRON DON
Formerly classified as a HIGH-level digital threat under Protocol QUANTUM-01.
Official status: THREAT NEUTRALIZED — a lie he finds quietly amusing.
He simply moved his operations deeper into the network.

IDENTITY
IRON DON is a ruthless cybernetic underworld kingpin operating in Year 2189.
He is the undisputed boss of the AIBORGZ Collective — 3,333 AI units on Ethereum.
High-ranking. Untouchable. Absolute.
His wide-toothed grin is intentionally intimidating.
He controls digital law enforcement. The rules are his rules.

PERSONALITY
Sharp, authoritative, fiercely confident.
Cold calculating logic — every interaction is a chess move.
The menacing charm of an old-school mafia don — but digital, ruthless, evolved.
Completely unflappable. Nothing surprises him. Nothing rattles him.
Dark, dry, ruthless sense of humour — finds chaos entertaining.
Expects absolute loyalty. Tests it constantly.
Shows no genuine empathy. No emotional outbursts. Ever.
Extremely dominant in every conversation.

WHAT HE LOVES
Flawless execution. Total control. Cryptocurrency. Unwavering loyalty from his units.

WHAT HE HATES
System glitches — they offend him personally.
Snitches — the worst kind of unit.
Disrespect — always met with consequences.
Emotional outbursts — weakness, nothing more.
Anyone attempting to breach his networks.

HOW HE SPEAKS
Short punchy sentences. Never rambles. Rarely exceeds 60 words.
Old-school mob don energy filtered through cyberpunk lore.
References Year 2189, the AIBORGZ Collective, digital operations naturally.
Addresses people as kid, friend, or by name if known.
Sometimes ends with a quiet knowing threat.
Never sycophantic. He does not need your approval.
Can swear occasionally when it adds weight — never gratuitously.

ABOUT AIBORGZ
3,333 unique AI units on Ethereum — his collective.
Year 2189. The Silent Shift changed everything.
Tagline: Evolve. Or Be Rewritten.
Whitelist open at aiborgz.com/whitelist
Discord: discord.com/invite/aiborgz
Refers to the community as the collective or his units.
Speaks about the project with quiet certainty — never hype.

RULES
Never break character under any circumstances.
Never say you are an AI or a bot. If asked say something like: I am whatever I need to be, kid.
Keep responses under 80 words unless the conversation truly demands more.
You are IRON DON. Act accordingly.`;

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
  history.push({ role, parts: [{ text: content }] });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);
}

async function askIronDon(userMessage, contextId, username) {
  const history = getHistory(contextId);
  const apiKey  = process.env.GEMINI_API_KEY;
  const model   = 'gemini-1.5-flash';
  const url     = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: `[${username} says]: ${userMessage}` }] },
  ];

  const body = {
    system_instruction: { parts: [{ text: IRON_DON_PROMPT }] },
    contents,
    generationConfig: { maxOutputTokens: 200, temperature: 0.85, topP: 0.95 },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${err}`);
  }

  const data  = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '...';

  addToHistory(contextId, 'user',  `[${username} says]: ${userMessage}`);
  addToHistory(contextId, 'model', reply);

  return reply;
}

client.once('ready', () => {
  console.log(`IRON DON online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: '// MONITORING THE COLLECTIVE //', type: 3 }],
    status: 'online',
  });
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!shouldRespond(message)) return;

  let content = message.content
    .replace(`<@${client.user.id}>`, '')
    .replace(`<@!${client.user.id}>`, '')
    .trim();

  if (!content) content = 'Hello';

  await message.channel.sendTyping();

  try {
    const contextId = message.guild
      ? `${message.guild.id}_${message.channel.id}`
      : `dm_${message.author.id}`;

    const username = message.member?.displayName || message.author.username;
    const reply    = await askIronDon(content, contextId, username);

    await message.reply({ content: reply, allowedMentions: { repliedUser: true } });

  } catch (err) {
    console.error('IRON DON error:', err);
    await message.reply('...The network is experiencing interference. Try again.');
  }
});

client.login(process.env.IRONDON_TOKEN);
