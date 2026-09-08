// Same browser actions and evidence assertions as the retained Node adapter.
process.env.PLAYTEST_VERIFY_ADAPTER = 'cloud';
await import('./verify-remote-playtest.mjs');
