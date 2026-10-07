const { homedir } = require('node:os');
console.log(JSON.stringify({ home: homedir(), ledger: process.env.MUSH_MASTER_LEDGER_PATH }));
