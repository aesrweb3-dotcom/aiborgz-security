require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const holderDb = require('./holder-database');

// Exported as a router and mounted onto the Rumble OAuth server's existing
// app/port (see rumble-oauth-server.js) rather than listening on its own
// port - Railway only exposes one port per service publicly, so a second
// app.listen() here would just never be reachable from the internet.
const router = express.Router();

// Set by index.js once the Discord client is ready, and given
// checkAndAssignTier directly rather than importing holder-roles here, to
// avoid a require cycle (holder-roles doesn't need anything from this file).
let discordClient = null;
let checkAndAssignTierFn = null;
function attachDiscordClient(client, checkAndAssignTier) {
  discordClient = client;
  checkAndAssignTierFn = checkAndAssignTier;
}

// ── Landing page - linked from the DM/reply the bot sends. Wallet connect
// and signing happen client-side here, there's no OAuth redirect involved. ──
router.get('/wallet/start', (req, res) => {
  const { discordId, guildId } = req.query;
  if (!discordId || !guildId) {
    return res.status(400).send(renderStatusPage('Missing info', 'This link is missing required information. Go back to Discord and click Verify Wallet again.'));
  }
  const state = crypto.randomBytes(16).toString('hex');
  holderDb.storePendingState(state, discordId, guildId);
  res.send(renderConnectPage(state));
});

// ── Browser posts the signed message here once the wallet signs it ──
router.post('/wallet/verify', async (req, res) => {
  const { state, address, signature, message } = req.body || {};
  if (!state || !address || !signature || !message) {
    return res.status(400).json({ error: 'Missing data in request.' });
  }

  const pending = holderDb.getPendingState(state);
  if (!pending) {
    return res.status(400).json({ error: 'This verification link has expired. Go back to Discord and click Verify Wallet again.' });
  }
  holderDb.deletePendingState(state);

  try {
    // The nonce is single-use and only ever handed out for one specific
    // discord_id/guild_id pair, so confirming the signed message contains
    // it is what stops a signature from being replayed against someone
    // else's pending verification.
    if (!message.includes(state)) {
      return res.status(400).json({ error: 'Signed message did not match this verification request.' });
    }

    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== String(address).toLowerCase()) {
      return res.status(400).json({ error: 'Signature did not match the wallet address.' });
    }

    holderDb.storeWalletLink(pending.discord_id, pending.guild_id, recovered);

    let result = { balance: 0, tiers: [] };
    if (discordClient && checkAndAssignTierFn) {
      result = await checkAndAssignTierFn(pending.discord_id, pending.guild_id, recovered, discordClient);
    }

    res.json({ ok: true, balance: result.balance, tierNames: result.tiers.map(t => t.name) });
  } catch (err) {
    console.error('Wallet verify error:', err.message);
    res.status(500).json({ error: 'Could not verify signature. Please try again.' });
  }
});

router.get('/wallet/health', (req, res) => res.json({ status: 'ok' }));

function renderConnectPage(state) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verify Wallet — AIBORGZ</title>
<style>
  body{background:#050608;color:#c8d8e8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
  .card{max-width:420px;text-align:center;border:1px solid #1a1f2e;border-radius:10px;padding:40px 28px;background:#0a0c10;}
  h1{font-size:20px;color:#00e5ff;margin-bottom:14px;}
  p{font-size:14px;line-height:1.6;color:#8896a8;margin-bottom:24px;}
  button{background:#00e5ff;color:#04060b;border:none;border-radius:8px;padding:14px 28px;font-size:14px;font-weight:700;cursor:pointer;width:100%;}
  button:disabled{opacity:.5;cursor:default;}
  #status{margin-top:16px;font-size:13px;color:#8896a8;line-height:1.5;}
</style>
</head>
<body>
  <div class="card">
    <h1>Verify Your AIBORGZ Wallet</h1>
    <p>Connect your wallet and sign a free message to prove ownership. No transaction, no gas, nothing to approve, we never ask you to send anything.</p>
    <button id="connectBtn" onclick="connect()">Connect Wallet</button>
    <div id="status"></div>
  </div>
<script>
const STATE = ${JSON.stringify(state)};
async function connect(){
  const btn = document.getElementById('connectBtn');
  const status = document.getElementById('status');
  if (!window.ethereum) {
    status.textContent = 'No wallet found. Open this page from a device with MetaMask installed, or use your wallet app\\'s built-in browser.';
    return;
  }
  btn.disabled = true;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts[0];
    status.textContent = 'Confirm the signature request in your wallet...';
    const message = 'Verify wallet ownership for AIBORGZ Discord roles.\\n\\nNonce: ' + STATE;
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    });
    status.textContent = 'Verifying...';
    const res = await fetch('/wallet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: STATE, address, signature, message }),
    });
    const data = await res.json();
    if (data.ok) {
      status.textContent = (data.tierNames && data.tierNames.length)
        ? ('Verified! ' + data.balance + ' held — roles: ' + data.tierNames.join(', ') + '. Head back to Discord.')
        : ('Verified, but this wallet holds 0 AIBORGZ right now, so no tier role yet.');
      btn.style.display = 'none';
    } else {
      status.textContent = data.error || 'Verification failed.';
      btn.disabled = false;
    }
  } catch (err) {
    status.textContent = err.message || 'Something went wrong.';
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
}

function renderStatusPage(title, message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <style>body{background:#050608;color:#c8d8e8;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}.card{max-width:420px;text-align:center;border:1px solid #1a1f2e;border-radius:10px;padding:40px 28px;background:#0a0c10;}h1{font-size:20px;color:#00e5ff;margin-bottom:14px;}p{font-size:14px;line-height:1.6;color:#8896a8;}</style>
  </head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

module.exports = { router, attachDiscordClient };
