const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { STAGES, SIDE_STATES } = require('../statusRules');
const { HttpError } = require('../errors');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, stepDelaySec: config.STEP_DELAY_SEC, autoSimulate: config.AUTO_SIMULATE });
});

// Stage list for the progress bar and status badges
router.get('/meta', (req, res) => {
  res.json({ stages: STAGES, sideStates: SIDE_STATES });
});

// Fake login: the frontend lets you pick a user and sends their id.
router.get('/users', (req, res) => {
  res.json(db.prepare('SELECT id, name, role, pincode FROM users ORDER BY id').all());
});

router.get('/products', (req, res) => {
  const { kind, artisanId, artisan_id } = req.query;
  const aid = artisanId || artisan_id;
  const where = [];
  const params = [];

  if (kind) {
    where.push('kind = ?');
    params.push(String(kind).toUpperCase());
  }
  if (aid) {
    where.push('artisan_id = ?');
    params.push(Number(aid));
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM products ${whereClause} ORDER BY id DESC`).all(...params);
  res.json(rows);
});

router.get('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!product) throw new HttpError(404, 'Product not found');
  res.json(product);
});

// POST /api/products - list a new product
router.post('/products', (req, res) => {
  const {
    artisan_id,
    artisanId,
    name,
    description,
    kind = 'PHYSICAL',
    price,
    weight_grams = 0,
    length_cm = 0,
    width_cm = 0,
    height_cm = 0,
    fragile = 0,
    stock = 0,
    download_url = null,
    image_url = null,
  } = req.body || {};

  const aid = Number(artisan_id || artisanId);
  if (!aid) throw new HttpError(400, 'artisan_id is required');
  if (!name || !String(name).trim()) throw new HttpError(400, 'Product name is required');
  if (price === undefined || Number(price) <= 0) throw new HttpError(400, 'Price must be a positive number');

  const artisan = db.prepare('SELECT * FROM users WHERE id = ?').get(aid);
  if (!artisan) throw new HttpError(404, `Artisan ${aid} not found`);

  const productKind = String(kind).toUpperCase();
  if (!['PHYSICAL', 'AUDIO'].includes(productKind)) {
    throw new HttpError(400, 'kind must be PHYSICAL or AUDIO');
  }

  const info = db.prepare(
    `INSERT INTO products (
       artisan_id, name, description, kind, price,
       weight_grams, length_cm, width_cm, height_cm,
       fragile, stock, download_url, image_url
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    aid,
    String(name).trim(),
    description ? String(description).trim() : null,
    productKind,
    Math.round(Number(price)),
    Math.max(0, Math.round(Number(weight_grams) || 0)),
    Math.max(0, Number(length_cm) || 0),
    Math.max(0, Number(width_cm) || 0),
    Math.max(0, Number(height_cm) || 0),
    fragile ? 1 : 0,
    Math.max(0, Math.round(Number(stock) || 0)),
    download_url ? String(download_url).trim() : null,
    image_url ? String(image_url).trim() : null
  );

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json(product);
});

// PUT /api/products/:id - edit product
router.put('/products/:id', (req, res) => {
  const pid = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  if (!existing) throw new HttpError(404, 'Product not found');

  const {
    name,
    description,
    kind,
    price,
    weight_grams,
    length_cm,
    width_cm,
    height_cm,
    fragile,
    stock,
    download_url,
    image_url,
  } = req.body || {};

  db.prepare(
    `UPDATE products
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         kind = COALESCE(?, kind),
         price = COALESCE(?, price),
         weight_grams = COALESCE(?, weight_grams),
         length_cm = COALESCE(?, length_cm),
         width_cm = COALESCE(?, width_cm),
         height_cm = COALESCE(?, height_cm),
         fragile = COALESCE(?, fragile),
         stock = COALESCE(?, stock),
         download_url = COALESCE(?, download_url),
         image_url = COALESCE(?, image_url)
     WHERE id = ?`
  ).run(
    name !== undefined ? String(name).trim() : null,
    description !== undefined ? String(description).trim() : null,
    kind !== undefined ? String(kind).toUpperCase() : null,
    price !== undefined ? Math.round(Number(price)) : null,
    weight_grams !== undefined ? Math.round(Number(weight_grams)) : null,
    length_cm !== undefined ? Number(length_cm) : null,
    width_cm !== undefined ? Number(width_cm) : null,
    height_cm !== undefined ? Number(height_cm) : null,
    fragile !== undefined ? (fragile ? 1 : 0) : null,
    stock !== undefined ? Math.round(Number(stock)) : null,
    download_url !== undefined ? String(download_url).trim() : null,
    image_url !== undefined ? String(image_url).trim() : null,
    pid
  );

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  res.json(updated);
});

// POST /api/products/:id/offline-sale - record in-person sale at fair or stall
router.post('/products/:id/offline-sale', (req, res) => {
  const pid = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  if (!product) throw new HttpError(404, 'Product not found');

  const { quantity = 1, artisanId, artisan_id, salePrice, notes } = req.body || {};
  const aid = Number(artisanId || artisan_id || product.artisan_id);

  if (aid !== product.artisan_id) {
    throw new HttpError(403, 'This product belongs to another artisan');
  }

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new HttpError(400, 'quantity must be an integer, 1 or more');
  }

  if (product.stock < qty) {
    throw new HttpError(409, `Insufficient stock (available: ${product.stock}, requested: ${qty})`);
  }

  const unitPrice = salePrice !== undefined ? Math.round(Number(salePrice)) : product.price;
  const totalAmount = unitPrice * qty;
  const createdAt = new Date().toISOString();

  const sale = db.transaction(() => {
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, pid);
    const info = db.prepare(
      `INSERT INTO offline_sales (product_id, artisan_id, quantity, unit_price, total_amount, notes, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(pid, aid, qty, unitPrice, totalAmount, notes ? String(notes).trim() : 'Mela / stall cash sale', createdAt);

    return db.prepare('SELECT * FROM offline_sales WHERE id = ?').get(Number(info.lastInsertRowid));
  })();

  const updatedProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
  res.status(201).json({
    success: true,
    product: updatedProduct,
    sale,
  });
});


// Pickup hubs for artisans without courier access: GET /api/hubs?pincode=302001 (same area first)
router.get('/hubs', (req, res) => {
  const pin = String(req.query.pincode || '');
  const hubs = db.prepare('SELECT * FROM hubs ORDER BY id').all();
  if (pin.length >= 3) {
    const nearby = hubs.filter((h) => h.pincode.startsWith(pin.slice(0, 3)));
    if (nearby.length) return res.json(nearby);
  }
  res.json(hubs);
});

// Notification bell / fake SMS preview tab
router.get('/notifications', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) throw new HttpError(400, 'userId is required');
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC').all(userId));
});

router.patch('/notifications/read-all', (req, res) => {
  const userId = Number(req.query.userId || (req.body && req.body.userId));
  if (!userId) throw new HttpError(400, 'userId is required');
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
  res.json({ ok: true });
});

router.patch('/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
