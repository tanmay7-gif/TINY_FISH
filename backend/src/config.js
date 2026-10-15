const path = require('path');

// Read at call time everywhere (do not destructure) so tests and demos can change values live.
module.exports = {
  PORT: Number(process.env.PORT) || 4000,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hunar.db'),

  // Mock courier timing. Demo: seconds. Production: hours and days.
  STEP_DELAY_SEC: process.env.STEP_DELAY_SEC !== undefined ? Number(process.env.STEP_DELAY_SEC) : 30,
  AUTO_SIMULATE: process.env.AUTO_SIMULATE !== 'false',

  // Edge case: artisan does not pack in time
  AUTO_CANCEL_MINUTES: process.env.AUTO_CANCEL_MINUTES !== undefined ? Number(process.env.AUTO_CANCEL_MINUTES) : 2880,
  AUTO_CANCEL_CHECK_SEC: Number(process.env.AUTO_CANCEL_CHECK_SEC) || 60,

  // Hunar BuyMe margin
  PLATFORM_FEE_PCT: process.env.PLATFORM_FEE_PCT !== undefined ? Number(process.env.PLATFORM_FEE_PCT) : 10,
};
