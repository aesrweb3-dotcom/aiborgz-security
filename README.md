# AIBORGZ Security Bot

Alt detection and ban evasion protection for the AIBORGZ Discord server.

---

## What It Does

- Automatically flags new members based on risk signals
- Compares usernames and avatars against your ban list
- Alerts mods in a private channel with Approve / Kick / Ban buttons
- DMs flagged members so they know a mod will review them
- Logs every ban automatically for future comparison
- Manual commands for checking specific members

---

## Setup — Step by Step

### 1. Create the Discord Application

1. Go to https://discord.com/developers/applications
2. Click **New Application** — name it **AIBORGZ Security**
3. Go to **Bot** tab → click **Add Bot**
4. Copy the **Token** — you'll need this
5. Under **Privileged Gateway Intents** enable ALL THREE:
   - Server Members Intent ✅
   - Message Content Intent ✅
   - Presence Intent ✅
6. Click **Save Changes**

### 2. Invite the Bot to Your Server

1. Go to **OAuth2** → **URL Generator**
2. Scopes: tick `bot`
3. Bot Permissions: tick these:
   - Manage Roles
   - Kick Members
   - Ban Members
   - Read Messages / View Channels
   - Send Messages
   - Embed Links
   - Read Message History
4. Copy the generated URL and open it in your browser
5. Select your AIBORGZ server and authorise

### 3. Set Up Discord Server

Create these in your Discord server before starting the bot:

**Channel:** `#security-log` (private — mods only, bot needs access)
**Role:** `Quarantine` (no permissions — blocks access to all channels)

### 4. Deploy to Railway

1. Go to https://railway.app
2. New Project → Deploy from GitHub repo (push this code to a repo first)
   OR New Project → Deploy from template → Node.js
3. Add these environment variables in Railway settings:
   - `DISCORD_TOKEN` = your bot token
   - `LOG_CHANNEL` = security-log
   - `QUARANTINE_ROLE` = Quarantine
   - `PREFIX` = !sec
   - `FLAG_THRESHOLD` = 30
   - `DB_PATH` = /data/security.db
4. Deploy

---

## Commands

All commands require **Ban Members** permission.

| Command | Description |
|---------|-------------|
| `!sec help` | Show all commands |
| `!sec stats` | Security statistics |
| `!sec recent` | Recent flagged joins |
| `!sec bans` | Full tracked ban list |
| `!sec check <userId>` | Manually check a member |
| `!sec addban <userId>` | Add someone to ban tracking manually |
| `!sec removeban <userId>` | Remove from ban tracking |
| `!sec approve <userId>` | Approve a flagged member |

---

## Risk Scoring

| Score | Severity | Action |
|-------|----------|--------|
| 0-29 | Clean | No action |
| 30-44 | LOW | Flagged + alerted |
| 45-69 | MEDIUM | Flagged + quarantined |
| 70-100 | HIGH | Flagged + quarantined |

**Flags that increase score:**
- Account under 1 day old (+40)
- Account under 7 days old (+25)
- Account under 30 days old (+10)
- Default avatar (+15)
- Username similar to banned user (+up to 35)
- Avatar similar to banned user (+up to 40)
- Previously banned account rejoining (+100, instant flag)

---

## How Ban Tracking Works

The bot automatically stores ban data every time someone is banned from your server going forward. For existing bans you can use `!sec addban <userId>` to add them manually.

---

## Adjusting Sensitivity

Change `FLAG_THRESHOLD` in Railway environment variables:
- `20` = very sensitive, flags almost everything
- `30` = recommended — catches most alts
- `50` = medium — only flags clear alts
- `70` = strict — only flags obvious cases
