const config = require('./config');
const { db } = require('./db');
const { createApp } = require('./app');
const orders = require('./orderService');
const simulator = require('./simulator');

// First run: seed demo data if the database is empty.
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  require('./seed').seedData();
  console.log('Empty database: seeded demo data.');
}

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`Hunar backend running on http://localhost:${config.PORT}`);
  console.log(`Courier step delay: ${config.STEP_DELAY_SEC}s, auto-simulate: ${config.AUTO_SIMULATE}`);
});

// Pick up shipments that were mid-journey before a restart.
const resumed = simulator.resume(db);
if (resumed) console.log(`Resumed ${resumed} in-flight shipment(s).`);

// Edge case: auto-cancel orders the artisan never packed.
if (config.AUTO_CANCEL_MINUTES > 0) {
  setInterval(() => {
    const cancelled = orders.autoCancelStale();
    if (cancelled.length) console.log(`Auto-cancelled stale orders: ${cancelled.join(', ')}`);
  }, config.AUTO_CANCEL_CHECK_SEC * 1000);
}
