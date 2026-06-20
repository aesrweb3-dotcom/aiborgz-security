// Runs all processes simultaneously on the same Railway deployment
const { startRumbleServer } = require('./rumble-oauth-server');

require('./index.js');     // AIBORGZ Security Bot
require('./irondon.js');   // IRON DON AI Character
startRumbleServer();       // Rumble Room X verification server

console.log('// AIBORGZ NETWORK ONLINE //');
