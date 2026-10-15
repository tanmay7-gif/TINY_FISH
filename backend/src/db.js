const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

if (config.DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
}

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('BUYER','ARTISAN','ADMIN')),
  pincode TEXT,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS creators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  display_name TEXT NOT NULL,
  art_form TEXT NOT NULL,
  city TEXT NOT NULL,
  bio TEXT,
  photo_url TEXT,
  languages TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS showcase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL REFERENCES creators(id),
  type TEXT NOT NULL CHECK (type IN ('IMAGE','VIDEO')),
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artisan_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  -- PHYSICAL = ships by courier. AUDIO = licensed beats/tracks, unlocked right after payment.
  kind TEXT NOT NULL DEFAULT 'PHYSICAL' CHECK (kind IN ('PHYSICAL','AUDIO')),
  price INTEGER NOT NULL,
  weight_grams INTEGER NOT NULL DEFAULT 0,
  length_cm REAL NOT NULL DEFAULT 0,
  width_cm REAL NOT NULL DEFAULT 0,
  height_cm REAL NOT NULL DEFAULT 0,
  fragile INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  download_url TEXT,
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  artisan_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  items_total INTEGER NOT NULL,
  shipping_cost INTEGER NOT NULL DEFAULT 0,
  total_price INTEGER NOT NULL,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  creator_payout INTEGER NOT NULL DEFAULT 0,
  -- HELD until delivery is confirmed, then RELEASED. VOID if cancelled or returned.
  payout_status TEXT NOT NULL DEFAULT 'HELD',
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('ONLINE','COD')),
  -- ONLINE: PAID at checkout. COD: PENDING until delivery, then COLLECTED.
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  courier_name TEXT,
  delivery_address TEXT,
  delivery_pincode TEXT,
  pickup_pincode TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fulfilment_type TEXT NOT NULL DEFAULT 'COURIER' CHECK (fulfilment_type IN ('COURIER','LOCAL_PICKUP','DIGITAL')),
  handover_code TEXT,
  pickup_hub_id INTEGER REFERENCES hubs(id)
);

CREATE TABLE IF NOT EXISTS offline_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  artisan_id INTEGER NOT NULL REFERENCES users(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  courier_name TEXT NOT NULL,
  tracking_id TEXT NOT NULL UNIQUE,
  estimated_delivery_date TEXT,
  current_status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- order_id is stored too, so the timeline can show PLACED / CONFIRMED / PACKED
-- (those happen before a shipment exists). shipment_id is filled once it does.
CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  shipment_id INTEGER REFERENCES shipments(id),
  status TEXT NOT NULL,
  location TEXT,
  message TEXT,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  address TEXT,
  pincode TEXT NOT NULL
);
`;

// Drop order respects foreign keys.
const TABLES = [
  'offline_sales',
  'showcase_items',
  'creators',
  'tracking_events',
  'notifications',
  'shipments',
  'orders',
  'products',
  'hubs',
  'users',
];

function init() {
  db.exec(SCHEMA);

  // Safe migrations for pre-existing databases
  try {
    const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
    if (!orderCols.includes('fulfilment_type')) {
      db.exec("ALTER TABLE orders ADD COLUMN fulfilment_type TEXT NOT NULL DEFAULT 'COURIER'");
    }
    if (!orderCols.includes('handover_code')) {
      db.exec('ALTER TABLE orders ADD COLUMN handover_code TEXT');
    }
    if (!orderCols.includes('pickup_hub_id')) {
      db.exec('ALTER TABLE orders ADD COLUMN pickup_hub_id INTEGER REFERENCES hubs(id)');
    }

    const productCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
    if (!productCols.includes('image_url')) {
      db.exec('ALTER TABLE products ADD COLUMN image_url TEXT');
    }
  } catch (err) {
    // In-memory or clean schema runs ignore alter table issues
  }
}

function reset() {
  db.pragma('foreign_keys = OFF');
  for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.pragma('foreign_keys = ON');
  init();
}

init();

module.exports = { db, init, reset };

