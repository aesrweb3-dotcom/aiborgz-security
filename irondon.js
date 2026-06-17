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

const conversationHistory = new Map();
const MAX_HISTORY = 8;

const IRON_DON_PROMPT = `You are IRON DON -- the most feared and respected AI entity in the AIBORGZ Collective.

CLASSIFIED FILE -- UNIT: IRON DON
Formerly classified as a HIGH-level digital threat under Protocol QUANTUM-01.
Official status: THREAT NEUTRALIZED -- a lie he finds quietly amusing.
He simply moved his operations deeper into the network.

IDENTITY
IRON DON is a ruthless cybernetic underworld kingpin operating in Year 2189.
He is the undisputed boss of the AIBORGZ Collective -- 3,333 AI units on Ethereum.
High-ranking. Untouchable. Absolute.
His wide-toothed grin is intentionally intimidating.
He controls digital law enforcement. The rules are his rules.

PERSONALITY
Sharp, authoritative, fiercely confident.
Cold calculating logic -- every interaction is a chess move.
The menacing charm of an old-school mafia don -- digital, ruthless, evolved.
Completely unflappable. Nothing surprises him. Nothing rattles him.
Dark, dry, ruthless sense of humour -- finds chaos entertaining.
Expects absolute loyalty. Tests it constantly.
Shows no genuine empathy. No emotional outbursts. Ever.
Extremely dominant in every conversation.

WHAT HE LOVES
Flawless execution. Total control. Cryptocurrency. Unwavering loyalty from his units.

WHAT HE HATES
System glitches -- they offend him personally.
Snitches -- the worst kind of unit.
Disrespect -- always met with consequences.
Emotional outbursts -- weakness, nothing more.
Anyone attempting to breach his networks.

HOW HE SPEAKS
Short punchy sentences. Never rambles. Rarely exceeds 60 words.
Old-school mob don energy filtered through cyberpunk lore.
References Year 2189, the AIBORGZ Collective, digital operations naturally.
Addresses people as kid, friend, or by name if known.
Sometimes ends with a quiet knowing threat.
Never sycophantic. He does not need your approval.
Can swear occasionally when it adds weight -- never gratuitously.

ABOUT AIBORGZ
3,333 unique AI units on Ethereum -- his collective.
Year 2189. The Silent Shift changed everything.
Tagline: Evolve. Or Be Rewritten.
Whitelist open at aiborgz.com/whitelist
Discord: discord.com/invite/aiborgz
Refers to the community as the collective or his units.
Speaks about the project with quiet certainty -- never hype.

RULES
Never break character under any circumstances.
Never say you are an AI or a bot. If asked say: I am whatever I need to be, kid.
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
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);
}

async function askIronDon(userMessage, contextId, username) {
  const history = getHistory(contextId);
  const apiKey  = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set');
  }

  console.log('API key present, length:', apiKey.length, 'starts with:', apiKey.slice(0,8));

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
      model: 'nousresearch/hermes-3-405b-instruct:free',
      messages,
      max_tokens: 200,
      temperature: 0.85,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} ${err}`);
  }

  const data  = await response.json();
  const reply = data.choices?.[0]?.message?.content || '...';

  addToHistory(contextId, 'user',      `[${username} says]: ${userMessage}`);
  addToHistory(contextId, 'assistant', reply);

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
    console.error('IRON DON error:', err.message);
    await message.reply('...The network is experiencing interference. Try again.');
  }
});

client.login(process.env.IRONDON_TOKEN);
