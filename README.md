# AIBORGZ Discord Network

Three things running together on one Railway deployment:
1. AIBORGZ Security Bot - alt detection and ban evasion protection
2. IRON DON - the AI personality bot
3. Rumble Room Gate - X (Twitter) engagement verification for Rumble Room entry

---

## Running It Locally (cmd / terminal)

### 1. Install dependencies
Open a terminal in the project folder and run:
```
npm install
```

### 2. Set up your environment file
Copy `.env.example` to a new file called `.env` in the same folder, then fill in every value (see the Setup sections below for where each one comes from).

### 3. Start everything
```
npm start
```
This runs `start.js`, which boots the Security Bot, IRON DON, and the Rumble Room verification server all at once. You'll see:
```
AIBORGZ Security online as ...
IRON DON online as ...
Rumble OAuth server listening on port 3001
// AIBORGZ NETWORK ONLINE //
```

### 4. Register the Rumble Room slash commands (one-time, or whenever you change them)
In a separate terminal window (keep the bot running in the first one), run:
```
node deploy-commands.js
```
You should see: Registered 3 command(s): /rumble-set-tweet, /rumble-set-entry, /rumble-status

---

## Deploying to Railway

1. Push this whole folder to your GitHub repo (aiborgz-security)
2. Railway will redeploy automatically on push
3. Add every variable from `.env.example` into Railway -> your project -> Variables
4. Once deployed, run `node deploy-commands.js` from Railway's shell (or run it locally once - it talks to Discord's API directly, doesn't need to run on the server itself)

---

# PART 1 - Security Bot Setup

### Create the Discord Application
1. Go to https://discord.com/developers/applications
2. New Application -> name it AIBORGZ Security
3. Bot tab -> Add Bot -> copy the Token (this is DISCORD_TOKEN)
4. Under Privileged Gateway Intents, enable:
   - Server Members Intent
   - Message Content Intent
   - Presence Intent
5. Save Changes

### Invite the Bot
1. OAuth2 -> URL Generator
2. Scopes: bot
3. Permissions: Manage Roles, Kick Members, Ban Members, View Channels, Send Messages, Embed Links, Read Message History
4. Open the generated URL, select your server, authorise

### Discord Server Setup
- Create channel #security-log (private, mods only)
- Create role Quarantine (no permissions)

### Commands (all require Ban Members permission)
| Command | Description |
|---|---|
| !sec help | Show all commands |
| !sec stats | Security statistics |
| !sec recent | Recent flagged joins |
| !sec bans | Full tracked ban list |
| !sec check userId | Manually check a member |
| !sec addban userId | Add someone to ban tracking |
| !sec removeban userId | Remove from ban tracking |
| !sec scanall | Scan every existing member |
| !sec approve userId | Approve a flagged member |

### Risk Scoring
| Score | Severity |
|---|---|
| 0-29 | Clean |
| 30-44 | LOW |
| 45-69 | MEDIUM |
| 70-100 | HIGH |

Adjust sensitivity with FLAG_THRESHOLD in your .env (20 = very sensitive, 70 = strict).

---

# PART 2 - IRON DON Setup

1. Create a second Discord Application the same way as above, name it IRON DON
2. Copy its token into IRONDON_TOKEN
3. Get an OpenRouter API key from https://openrouter.ai and put it in OPENROUTER_API_KEY
4. Optionally set IRONDON_CHANNELS to a comma-separated list of channel names where he should respond to every message without being mentioned (e.g. general,chat). Leave blank and he'll only respond when mentioned anywhere.

---

# PART 3 - Rumble Room Gate Setup

This is the new feature. It makes sure nobody can sit in the Rumble Room without actually following the entry rules on X - they must follow your account, like, and retweet a specific tweet you choose. Anyone who hasn't done all three gets their reaction removed and is walked through verification by DM. The bot checks this for real against the X API.

## One-Time Setup

### Step 1 - Get your X Developer credentials
1. Go to https://developer.x.com and open your App (or create one)
2. Go to Keys and Tokens:
   - Copy the Bearer Token, this is X_BEARER_TOKEN
3. Go to User authentication settings, then OAuth 2.0:
   - Enable OAuth 2.0
   - App permissions: Read
   - Type of App: Web App
   - Callback URI: https://YOUR-RAILWAY-URL.up.railway.app/rumble/callback (must match X_CALLBACK_URL exactly)
4. Copy the Client ID and Client Secret from this same page, these are X_CLIENT_ID and X_CLIENT_SECRET
5. Make sure these scopes are available: tweet.read, users.read, follows.read, like.read, offline.access

### Step 2 - Get your Discord IDs
- DISCORD_CLIENT_ID is in the Discord Developer Portal, your Security Bot app, General Information, Application ID
- DISCORD_SERVER_ID is found by enabling Developer Mode in Discord (Settings, Advanced), then right-click your server icon, Copy Server ID

### Step 3 - Fill in .env / Railway variables
Use the full list from .env.example. The two most important to get right:
```
X_CALLBACK_URL=https://YOUR-RAILWAY-URL.up.railway.app/rumble/callback
BASE_URL=https://YOUR-RAILWAY-URL.up.railway.app
```
These must use your actual Railway URL once deployed, and X_CALLBACK_URL must be entered identically in the X Developer Portal.

### Step 4 - Register the slash commands
```
node deploy-commands.js
```

---

## How To Use It (Every Time You Run a New Competition)

### 1. Post your entry message in the Rumble Room
Something like:
"RUMBLE ROOM ENTRY: React with the entry emoji below to enter. You must follow @AIBORGZ and like plus retweet the pinned tweet to qualify."

### 2. Copy the Message ID
Right-click the message, Copy Message ID
(If you don't see this option, enable Developer Mode: Discord Settings, Advanced, Developer Mode)

### 3. Create a role for verified entrants
Server Settings, Roles, New Role, call it something like Rumble Verified (no special permissions needed, just used as a gate)

### 4. Set the competition tweet
In any channel, run:
```
/rumble-set-tweet url:https://x.com/AIBORGZ/status/1234567890 x_username:AIBORGZ
```
url is the exact tweet people need to like and retweet. x_username is your account they need to follow (without the @).

### 5. Set the entry message and role
```
/rumble-set-entry message_id:1234567890 channel:#rumble-room role:@Rumble Verified
```

### 6. Confirm it's all set
```
/rumble-status
```
This shows you the current tweet, account, entry message, channel, and role, check it all looks right.

### 7. Lock down the Rumble Room channel
In the Rumble Room's channel permissions, remove general access and only allow the Rumble Verified role to view and send messages.

---

## What Happens When Someone Reacts

1. User reacts to your entry message
2. Bot immediately removes their reaction (they're not verified yet) and sends them a DM with a Verify on X link
3. They click it, log into X (one-time), and approve access
4. The server checks: do they follow you, did they like the tweet, did they retweet it
5. All three pass: they get the Rumble Verified role instantly plus a DM confirming it
6. Any fail: they get told exactly what's missing and no role is given
7. They go back to Discord and react again, now that they're verified, it goes through cleanly

Every 10 minutes, a background check runs and strips the Rumble Verified role from anyone who has it without a real verified record in the database.

## Running a New Competition Next Time
Just repeat steps 4 to 6 with a new tweet URL and, if needed, a new entry message.

## Troubleshooting
- Bot doesn't DM the user: their Discord DMs are closed to non-friends, they'll need to open DMs from the server temporarily.
- "Could not find that X user" when running /rumble-set-tweet: double check the username has no typos and no @ symbol.
- Verification fails even after doing it correctly: X's API has a short delay sometimes, wait 1-2 minutes and react again in Discord to re-trigger.
- Role not removed from people who should still have it: check the tweet_url in /rumble-status matches what you expect.

---

# PART 4 - Sales Bot Setup

Posts every AIBORGZ sale to a channel of your choice - price, buyer, seller, item image. It rides on IRON DON's existing connection, so there's no new bot application to create. It never touches the AI/roast logic; sale data is posted directly, not generated.

## One-Time Setup

### Step 1 - Get an OpenSea API key
1. Go to https://docs.opensea.io and request an API key (free tier is enough for this)
2. Put it in `OPENSEA_API_KEY`

### Step 2 - Get the channel ID to post into
1. Create or pick the channel (e.g. #sales)
2. Enable Developer Mode if you haven't (Discord Settings, Advanced, Developer Mode)
3. Right-click the channel, Copy Channel ID
4. Put it in `SALES_CHANNEL_ID`

### Step 3 - Deploy
Add `OPENSEA_API_KEY` and `SALES_CHANNEL_ID` to Railway's Variables (same place as everything else) and redeploy. You'll see in the logs:
```
Sales bot: watching "aiborgz" for sales every 60s.
```

That's it, no slash command to register for this one. It checks for new sales once a minute and posts each one as it finds it. `OPENSEA_COLLECTION_SLUG` defaults to `aiborgz` and only needs setting if that ever changes.

## Troubleshooting
- Nothing posts: check Railway logs for "OPENSEA_API_KEY or SALES_CHANNEL_ID not set" - one of them is missing or mistyped.
- "could not find SALES_CHANNEL_ID": IRON DON's bot needs to actually be in that channel with permission to view it and send messages.
- Old sales flood in on first deploy: shouldn't happen, it starts watching from the moment it first boots, not from the collection's full history. If it does, check the server clock/timezone Railway is running with.

---

# PART 5 - Holder Roles Setup

Holders connect their wallet, sign a free message proving ownership (no transaction, no gas, nothing to approve), and get a Discord role based on how many AIBORGZ they hold. Rechecks every 10 minutes, so buying more or selling moves you to the correct role automatically, not just at the moment you first verified.

Tiers, highest one a holder qualifies for wins, they're never stacked:

| Holdings | Role |
|---|---|
| 1+ | LOW THREAT |
| 5+ | MODERATE THREAT |
| 10+ | HIGH THREAT |
| 25+ | SEVERE THREAT |
| 50+ | CLASSIFIED |

## One-Time Setup

### Step 1 - Create the five roles
Server Settings → Roles → create all five with whatever colors/names you want (Security Bot app, General Information tab has your Application ID if you need `DISCORD_CLIENT_ID` again). Then get each role's ID: Developer Mode on, right-click each role → Copy Role ID.

### Step 2 - Fill in `.env` / Railway variables
```
ROLE_LOW_THREAT=...
ROLE_MODERATE_THREAT=...
ROLE_HIGH_THREAT=...
ROLE_SEVERE_THREAT=...
ROLE_CLASSIFIED=...
```
`AIBORGZ_CONTRACT_ADDRESS` and `ROBINHOOD_RPC_URL` already default correctly in the code, only set them if either ever changes. `BASE_URL` is the same variable the Rumble Room Gate already uses, no need to set it twice.

### Step 3 - Register the slash command
```
node deploy-commands.js
```
You should see `/holder-post-verify` in the registered list alongside the Rumble commands.

### Step 4 - Post the entry message
In any channel:
```
/holder-post-verify channel:#verify
```
This posts an embed with a **Verify Wallet** button. Clicking it DMs/replies with a personal link to connect and sign.

## Troubleshooting
- Button does nothing / link errors: check `BASE_URL` matches your actual Railway URL exactly, same requirement as the Rumble Room Gate.
- Verified but no role: that wallet holds 0 AIBORGZ, the page will say so directly instead of silently failing.
- Role doesn't update after a wallet buys/sells: recheck runs every 10 minutes, not instantly, wait for the next cycle or nudge it by having them click Verify Wallet again.
- "No wallet found" on the verify page: they need to open the link from a browser with MetaMask (or similar) installed, or from inside their wallet app's own browser, not a browser with no wallet extension at all.
