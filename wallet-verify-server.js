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

// Same Reown/WalletConnect project as the main AIBORGZ site's wallet-connect.js,
// reused rather than provisioning a second project just for this page.
const WALLETCONNECT_PROJECT_ID = '9cd5dd4a4dceaec451e09df7363986e4';
const CHAIN_ID = 4663; // Robinhood Chain
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com/';

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

    try {
      holderDb.storeWalletLink(pending.discord_id, pending.guild_id, recovered);
    } catch (linkErr) {
      // e.g. this wallet is already linked to someone else's Discord account
      return res.status(400).json({ error: linkErr.message });
    }

    let result = { balance: 0, tiers: [] };
    if (discordClient && checkAndAssignTierFn) {
      result = await checkAndAssignTierFn(pending.discord_id, pending.guild_id, discordClient);
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
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1">
<title>Verify Wallet — AIBORGZ</title>
<style>
  *{box-sizing:border-box}
  body{background:#050608;color:#c8d8e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
  .card{width:100%;max-width:420px;text-align:center;border:1px solid #1a1f2e;border-radius:10px;padding:36px 24px;background:#0a0c10;}
  h1{font-size:19px;color:#00e5ff;margin:0 0 12px;}
  p.sub{font-size:14px;line-height:1.6;color:#8896a8;margin:0 0 24px;}
  .opt{display:flex;align-items:center;gap:14px;width:100%;background:rgba(240,244,255,.03);border:1px solid rgba(0,229,255,.15);border-radius:8px;padding:16px;margin-bottom:10px;cursor:pointer;color:#f0f4ff;font-size:15px;font-weight:600;text-align:left;-webkit-tap-highlight-color:transparent;}
  .opt:active{background:rgba(0,229,255,.1);}
  .opt:disabled{opacity:.5;}
  .opt .ic{width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:19px;}
  #status{margin-top:18px;font-size:13px;color:#8896a8;line-height:1.6;min-height:20px;}
</style>
</head>
<body>
  <div class="card">
    <h1>Verify Your AIBORGZ Wallet</h1>
    <p class="sub">Connect and sign a free message to prove ownership. No transaction, no gas, nothing to approve, ever. Already verified another wallet? This adds it, your holdings stack.</p>
    <button class="opt" id="mmBtn" onclick="connectMetaMask()"><span class="ic">🦊</span> MetaMask</button>
    <button class="opt" id="wcBtn" onclick="connectWalletConnect()"><span class="ic">🔗</span> WalletConnect</button>
    <div id="status"></div>
  </div>
<script>
const STATE = ${JSON.stringify(state)};
const WC_PROJECT_ID = ${JSON.stringify(WALLETCONNECT_PROJECT_ID)};
const CHAIN_ID = ${CHAIN_ID};
const RPC_URL = ${JSON.stringify(RPC_URL)};

function setStatus(msg){ document.getElementById('status').textContent = msg; }
function setBusy(busy){
  document.getElementById('mmBtn').disabled = busy;
  document.getElementById('wcBtn').disabled = busy;
}

function loadScript(src){
  return new Promise((res, rej) => {
    if (document.querySelector('script[src="' + src + '"]')) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function signAndVerify(provider, address){
  setStatus('Confirm the signature request in your wallet...');
  const message = 'Verify wallet ownership for AIBORGZ Discord roles.\\n\\nNonce: ' + STATE;
  const signature = await provider.request({ method: 'personal_sign', params: [message, address] });
  setStatus('Verifying...');
  const res = await fetch('/wallet/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: STATE, address, signature, message }),
  });
  const data = await res.json();
  if (data.ok) {
    setStatus((data.tierNames && data.tierNames.length)
      ? ('Verified! ' + data.balance + ' held across your linked wallets — roles: ' + data.tierNames.join(', ') + '. Head back to Discord.')
      : ('Verified, but your linked wallets hold 0 AIBORGZ right now, so no tier role yet.'));
    setBusy(true);
  } else {
    setStatus(data.error || 'Verification failed.');
    setBusy(false);
  }
}

async function connectMetaMask(){
  if (!window.ethereum) {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      // No injected wallet in this mobile browser - hand off to MetaMask's
      // own in-app browser, which reloads this exact page with window.ethereum present.
      const target = window.location.host + window.location.pathname + window.location.search;
      window.location.href = 'https://metamask.app.link/dapp/' + target;
      return;
    }
    setStatus('MetaMask not found. Install the browser extension, or use WalletConnect instead.');
    return;
  }
  setBusy(true);
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await signAndVerify(window.ethereum, accounts[0]);
  } catch (err) {
    setStatus(err.message || 'Something went wrong.');
    setBusy(false);
  }
}

async function connectWalletConnect(){
  setBusy(true);
  setStatus('Loading WalletConnect...');
  try {
    // The v2 UMD bundle expects Node globals - shim them first
    window.process = window.process || { env: {} };
    window.global = window.global || window;
    if (!window['@walletconnect/ethereum-provider']?.EthereumProvider) {
      await loadScript('https://unpkg.com/@walletconnect/ethereum-provider@2.13.0/dist/index.umd.js');
    }
    const ns = window['@walletconnect/ethereum-provider'];
    const EthereumProvider = ns?.EthereumProvider ?? ns?.default;
    if (!EthereumProvider?.init) throw new Error('WalletConnect failed to load');

    const provider = await EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      chains: [CHAIN_ID],
      showQrModal: true,
      rpcMap: { [CHAIN_ID]: RPC_URL },
      metadata: {
        name: 'AIBORGZ Holder Verify',
        description: 'Verify AIBORGZ wallet ownership for Discord roles',
        url: window.location.origin,
        icons: ['https://aiborgz.com/Logo.png'],
      },
    });

    setStatus('Scan the QR with your wallet app, or approve if you\\'re already on mobile.');
    await provider.connect();
    const accounts = provider.accounts || [];
    if (!accounts.length) throw new Error('No accounts returned');
    await signAndVerify(provider, accounts[0]);
  } catch (err) {
    const msg = err?.message || String(err);
    setStatus(/closed|cancell|reject/i.test(msg) ? 'Connection cancelled.' : msg);
    setBusy(false);
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
