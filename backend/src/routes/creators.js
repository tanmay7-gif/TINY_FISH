const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { HttpError } = require('../errors');

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video') ? '.mp4' : '.jpg');
    cb(null, `showcase-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max for showcase video/image
});

// GET /api/creators - list all creators
router.get('/', (req, res) => {
  const { art_form, city, q } = req.query;
  const where = [];
  const params = [];

  if (art_form) {
    where.push('LOWER(c.art_form) LIKE LOWER(?)');
    params.push(`%${art_form}%`);
  }
  if (city) {
    where.push('LOWER(c.city) LIKE LOWER(?)');
    params.push(`%${city}%`);
  }
  if (q) {
    where.push('(LOWER(c.display_name) LIKE LOWER(?) OR LOWER(c.art_form) LIKE LOWER(?) OR LOWER(c.bio) LIKE LOWER(?))');
    const term = `%${q}%`;
    params.push(term, term, term);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM showcase_items s WHERE s.creator_id = c.id) AS showcase_count,
      (SELECT COUNT(*) FROM products p WHERE p.artisan_id = c.user_id) AS product_count,
      (SELECT url FROM showcase_items s WHERE s.creator_id = c.id ORDER BY s.id ASC LIMIT 1) AS preview_media
    FROM creators c
    ${whereClause}
    ORDER BY c.verified DESC, c.id ASC
  `;

  const creators = db.prepare(sql).all(...params);
  res.json(creators);
});

// Helper to find creator by id or user_id
function findCreator(idOrUserId) {
  const num = Number(idOrUserId);
  if (!num) return null;
  return (
    db.prepare('SELECT * FROM creators WHERE id = ?').get(num) ||
    db.prepare('SELECT * FROM creators WHERE user_id = ?').get(num)
  );
}

// GET /api/creators/:id - profile + showcase items + products
router.get('/:id', (req, res) => {
  const creator = findCreator(req.params.id);
  if (!creator) throw new HttpError(404, 'Creator not found');

  const showcase = db.prepare('SELECT * FROM showcase_items WHERE creator_id = ? ORDER BY id DESC').all(creator.id);
  const products = db.prepare('SELECT * FROM products WHERE artisan_id = ? ORDER BY id DESC').all(creator.user_id);
  const user = db.prepare('SELECT id, name, role, pincode, phone FROM users WHERE id = ?').get(creator.user_id);

  res.json({
    ...creator,
    user,
    showcase,
    products,
  });
});

// POST /api/creators - create creator profile
router.post('/', (req, res) => {
  const { user_id, display_name, art_form, city, bio, photo_url, languages, verified } = req.body || {};

  if (!user_id) throw new HttpError(400, 'user_id is required');
  if (!display_name || !String(display_name).trim()) throw new HttpError(400, 'display_name is required');
  if (!art_form || !String(art_form).trim()) throw new HttpError(400, 'art_form is required');
  if (!city || !String(city).trim()) throw new HttpError(400, 'city is required');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(user_id));
  if (!user) throw new HttpError(404, `User ${user_id} not found`);

  const existing = db.prepare('SELECT id FROM creators WHERE user_id = ?').get(Number(user_id));
  if (existing) throw new HttpError(409, `Creator profile already exists for user ${user_id}`);

  const info = db.prepare(
    `INSERT INTO creators (user_id, display_name, art_form, city, bio, photo_url, languages, verified)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    Number(user_id),
    String(display_name).trim(),
    String(art_form).trim(),
    String(city).trim(),
    bio ? String(bio).trim() : null,
    photo_url ? String(photo_url).trim() : null,
    languages ? String(languages).trim() : 'Hindi, English',
    verified ? 1 : 0
  );

  const created = db.prepare('SELECT * FROM creators WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json(created);
});

// PUT /api/creators/:id - update creator profile
router.put('/:id', (req, res) => {
  const creator = findCreator(req.params.id);
  if (!creator) throw new HttpError(404, 'Creator not found');

  const { display_name, art_form, city, bio, photo_url, languages, verified } = req.body || {};

  db.prepare(
    `UPDATE creators
     SET display_name = COALESCE(?, display_name),
         art_form = COALESCE(?, art_form),
         city = COALESCE(?, city),
         bio = COALESCE(?, bio),
         photo_url = COALESCE(?, photo_url),
         languages = COALESCE(?, languages),
         verified = COALESCE(?, verified)
     WHERE id = ?`
  ).run(
    display_name ? String(display_name).trim() : null,
    art_form ? String(art_form).trim() : null,
    city ? String(city).trim() : null,
    bio !== undefined ? String(bio).trim() : null,
    photo_url !== undefined ? String(photo_url).trim() : null,
    languages !== undefined ? String(languages).trim() : null,
    verified !== undefined ? (verified ? 1 : 0) : null,
    creator.id
  );

  const updated = db.prepare('SELECT * FROM creators WHERE id = ?').get(creator.id);
  res.json(updated);
});

// POST /api/creators/:id/showcase - add showcase item
router.post('/:id/showcase', upload.single('file'), (req, res) => {
  const creator = findCreator(req.params.id);
  if (!creator) throw new HttpError(404, 'Creator not found');

  let type = req.body ? req.body.type : null;
  let url = req.body ? req.body.url : null;
  const title = req.body ? req.body.title : null;
  const description = req.body ? req.body.description : null;

  if (req.file) {
    url = `/uploads/${req.file.filename}`;
    if (!type) {
      type = req.file.mimetype.startsWith('video') ? 'VIDEO' : 'IMAGE';
    }
  }

  if (!url || !String(url).trim()) throw new HttpError(400, 'Media url or uploaded file is required');
  type = String(type || 'IMAGE').toUpperCase();
  if (!['IMAGE', 'VIDEO'].includes(type)) {
    throw new HttpError(400, 'type must be IMAGE or VIDEO');
  }

  const createdAt = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO showcase_items (creator_id, type, url, title, description, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(
    creator.id,
    type,
    String(url).trim(),
    title ? String(title).trim() : null,
    description ? String(description).trim() : null,
    createdAt
  );

  const item = db.prepare('SELECT * FROM showcase_items WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json(item);
});

// POST /api/showcase-items - convenience endpoint
router.post('/showcase-items', upload.single('file'), (req, res) => {
  const creatorId = req.body ? req.body.creator_id || req.body.creatorId : null;
  if (!creatorId) throw new HttpError(400, 'creator_id is required');
  const creator = findCreator(creatorId);
  if (!creator) throw new HttpError(404, 'Creator not found');

  let type = req.body ? req.body.type : null;
  let url = req.body ? req.body.url : null;
  const title = req.body ? req.body.title : null;
  const description = req.body ? req.body.description : null;

  if (req.file) {
    url = `/uploads/${req.file.filename}`;
    if (!type) {
      type = req.file.mimetype.startsWith('video') ? 'VIDEO' : 'IMAGE';
    }
  }

  if (!url || !String(url).trim()) throw new HttpError(400, 'Media url or uploaded file is required');
  type = String(type || 'IMAGE').toUpperCase();
  if (!['IMAGE', 'VIDEO'].includes(type)) {
    throw new HttpError(400, 'type must be IMAGE or VIDEO');
  }

  const createdAt = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO showcase_items (creator_id, type, url, title, description, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(
    creator.id,
    type,
    String(url).trim(),
    title ? String(title).trim() : null,
    description ? String(description).trim() : null,
    createdAt
  );

  const item = db.prepare('SELECT * FROM showcase_items WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json(item);
});

module.exports = router;
