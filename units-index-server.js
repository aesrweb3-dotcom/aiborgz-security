const express = require('express');
const { getOwnedTokenIds } = require('./units-index');

// Exported as a router and mounted onto the Rumble OAuth server's existing
// app/port, same reasoning as wallet-verify-server.js - Railway only exposes
// one port per service publicly.
const router = express.Router();

// Registered before /units/:address - Express matches in order, and a
// wildcard segment would otherwise swallow this (address="health") first.
router.get('/units/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ status: 'ok' });
});

// Called cross-origin from aiborgz.com (a different origin than this
// Railway service), and it's just public on-chain ownership data - no
// cookies, no auth - so a wide-open CORS header is fine here.
router.get('/units/:address', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const address = req.params.address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  try {
    const tokenIds = getOwnedTokenIds(address);
    res.json({ tokenIds });
  } catch (e) {
    console.error('units/:address lookup failed:', e.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

module.exports = { router };
