require('dotenv').config();
const mongoose = require('mongoose');
const platform = require('../src/tenancy/platform');
const connections = require('../src/tenancy/connections');
const apply = process.argv.includes('--apply');
const migrate = process.argv.includes('--migrate');
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await platform.connect();
    const count = await require('../src/services/mediaMaintenance').run({ apply, migrate });
    console.log(`${apply ? 'Applied' : 'Dry run'}: ${count} files ${migrate ? 'to migrate' : 'eligible for cleanup'}`);
  } catch (error) { console.error('Media maintenance failed:', error.message); process.exitCode = 1; }
  finally { await connections.close(); await platform.close(); await mongoose.disconnect(); }
})();
