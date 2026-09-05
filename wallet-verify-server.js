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
  const existingWallets = holderDb.getWalletsForDiscordId(discordId).map(w => w.wallet_address);
  res.send(renderConnectPage(state, existingWallets));
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

function renderConnectPage(state, existingWallets = []) {
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
  .linked{text-align:left;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.15);border-radius:8px;padding:12px 14px;margin-bottom:18px;}
  .linked .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#00e5ff;margin-bottom:6px;font-weight:700;}
  .linked code{display:block;font-size:12px;color:#8896a8;padding:2px 0;}
</style>
</head>
<body>
  <div class="card">
    <h1>Verify Your AIBORGZ Wallet</h1>
    <p class="sub">Connect and sign a free message to prove ownership. No transaction, no gas, nothing to approve, ever.</p>
    ${existingWallets.length ? `
    <div class="linked">
      <div class="lbl">Already linked (${existingWallets.length})</div>
      ${existingWallets.map(w => `<code>${w}</code>`).join('')}
    </div>
    <p class="sub" style="margin-bottom:16px;">Connecting a <strong>different</strong> wallet below adds it, your holdings stack across all linked wallets. Reconnecting the same one just refreshes it.</p>
    ` : ''}
    <button class="opt" id="mmBtn" onclick="connectMetaMask()"><span class="ic">🦊</span> MetaMask</button>
    <button class="opt" id="cbBtn" onclick="connectCoinbase()"><span class="ic">🔵</span> Coinbase Wallet</button>
    <button class="opt" id="phBtn" onclick="connectPhantom()"><span class="ic">👻</span> Phantom</button>
    <button class="opt" id="okxBtn" onclick="connectOKX()"><span class="ic">⬛</span> OKX Wallet</button>
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
  document.getElementById('cbBtn').disabled = busy;
  document.getElementById('phBtn').disabled = busy;
  document.getElementById('okxBtn').disabled = busy;
  document.getElementById('wcBtn').disabled = busy;
}
function isMobile(){ return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

// Some people have more than one wallet extension installed at once, in
// which case window.ethereum can be either one (or a proxy over both) -
// this picks the actual MetaMask/Coinbase provider out of the pack instead
// of blindly trusting whichever one happened to grab window.ethereum first.
function injectedProviders(){
  if (!window.ethereum) return [];
  return window.ethereum.providers?.length ? window.ethereum.providers : [window.ethereum];
}

// EIP-6963 - newer wallets (Coinbase Wallet included) have moved to this for
// multi-wallet discovery instead of reliably populating window.ethereum.providers,
// which is exactly what was breaking Coinbase detection when another wallet
// extension was also installed. Wallets respond to the request event almost
// immediately, well before a person can click a connect button.
let eip6963Providers = [];
window.addEventListener('eip6963:announceProvider', (event) => {
  eip6963Providers.push(event.detail);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

// rdns is a wallet-specific reverse-domain id from EIP-6963 - much harder to
// spoof than a boolean flag. Several real wallets (Rabby, Exodus) set
// isMetaMask:true on themselves for backward-compat with dapps that only
// check the flag, which was making the MetaMask button grab those instead
// of real MetaMask whenever both were installed. Trust rdns first, and only
// fall back to the flag for wallets old enough not to support EIP-6963 at all.
function matchesWallet(provider, info, rdnsPattern, legacyFlag){
  if (info?.rdns) return rdnsPattern.test(info.rdns);
  return !!provider?.[legacyFlag];
}
function isCoinbase(provider, info){ return matchesWallet(provider, info, /coinbase/i, 'isCoinbaseWallet'); }
function isMetaMask(provider, info){ return matchesWallet(provider, info, /metamask/i, 'isMetaMask'); }
function isPhantom(provider, info){ return matchesWallet(provider, info, /phantom/i, 'isPhantom'); }
function isOkx(provider, info){ return matchesWallet(provider, info, /okx|okex/i, 'isOkxWallet'); }
function findProvider(match){
  const viaEip6963 = eip6963Providers.find(d => match(d.provider, d.info));
  if (viaEip6963) return viaEip6963.provider;
  return injectedProviders().find(p => match(p, {}));
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
  const provider = findProvider(isMetaMask);
  if (!provider) {
    if (isMobile()) {
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
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    await signAndVerify(provider, accounts[0]);
  } catch (err) {
    setStatus(err.message || 'Something went wrong.');
    setBusy(false);
  }
}

async function connectCoinbase(){
  const provider = findProvider(isCoinbase);
  if (!provider) {
    if (isMobile()) {
      // No injected Coinbase provider here - hand off to Coinbase Wallet's
      // own in-app dapp browser, which reloads this exact page from inside
      // the app where the provider is present.
      window.location.href = 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(window.location.href);
      return;
    }
    setStatus('Coinbase Wallet not found. Opening the extension download page...');
    window.open('https://www.coinbase.com/wallet/downloads', '_blank');
    return;
  }
  setBusy(true);
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    await signAndVerify(provider, accounts[0]);
  } catch (err) {
    setStatus(err.message || 'Something went wrong.');
    setBusy(false);
  }
}

async function connectPhantom(){
  // Phantom exposes its EVM provider at window.phantom.ethereum specifically
  // to avoid the window.ethereum collision other wallets fight over, so
  // check there first - it's the one namespace only Phantom populates.
  const provider = window.phantom?.ethereum || findProvider(isPhantom);
  if (!provider) {
    if (isMobile()) {
      // Both url and ref are required per Phantom's own deeplink docs - a
      // browse link missing ref is not guaranteed to work.
      window.location.href = 'https://phantom.app/ul/browse/' + encodeURIComponent(window.location.href)
        + '?ref=' + encodeURIComponent(window.location.origin);
      return;
    }
    setStatus('Phantom not found. Opening the extension download page...');
    window.open('https://phantom.app/download', '_blank');
    return;
  }
  setBusy(true);
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    await signAndVerify(provider, accounts[0]);
  } catch (err) {
    setStatus(err.message || 'Something went wrong.');
    setBusy(false);
  }
}

async function connectOKX(){
  // OKX injects its own dedicated namespace (window.okxwallet) rather than
  // a legacy isOkxWallet-style flag, same idea as Phantom's window.phantom.ethereum.
  const provider = window.okxwallet || findProvider(isOkx);
  if (!provider) {
    if (isMobile()) {
      // Unlike MetaMask/Phantom/Coinbase, OKX's mobile deep link expects a
      // live WalletConnect pairing URI, not a plain "open this URL" link -
      // WalletConnect's own modal already deep-links into OKX from its
      // wallet list, so route through the connector already built for that.
      setStatus('Opening WalletConnect - pick OKX Wallet from the list...');
      await connectWalletConnect();
      return;
    }
    setStatus('OKX Wallet not found. Opening the extension download page...');
    window.open('https://web3.okx.com/download', '_blank');
    return;
  }
  setBusy(true);
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    await signAndVerify(provider, accounts[0]);
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
