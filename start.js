// Runs all processes simultaneously on the same Railway deployment
const { startRumbleServer } = require('./rumble-oauth-server');
const { startWalletVerifyServer } = require('./wallet-verify-server');

require('./index.js');       // AIBORGZ Security Bot
require('./irondon.js');     // IRON DON AI Character
startRumbleServer();         // Rumble Room X verification server
startWalletVerifyServer();   // Holder role wallet verification server

console.log('// AIBORGZ NETWORK ONLINE //');
