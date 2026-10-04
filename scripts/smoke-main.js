// Test-only entry point: installs the smoke hook, then starts the application's real main file unchanged.
require('./smoke-hook.js');
require('../electron/main.js');
