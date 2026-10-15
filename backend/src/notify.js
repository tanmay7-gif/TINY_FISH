const { db } = require('./db');

// Mock notifications: stored for the in-app bell / fake SMS preview tab, and printed to the console.
// To go real later, replace the body with Twilio, WhatsApp Business API or email.
// Callers keep using notify(userId, message) and nothing else changes.
function notify(userId, message) {
  db.prepare('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)').run(
    userId,
    message,
    new Date().toISOString()
  );
  console.log(`[notify -> user ${userId}] ${message}`);
}

module.exports = { notify };
