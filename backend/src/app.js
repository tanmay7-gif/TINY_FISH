const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { HttpError } = require('./errors');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));

  app.use('/api/creators', require('./routes/creators'));
  app.use('/api/delivery', require('./routes/delivery'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api/shipments', require('./routes/shipments'));
  app.use('/api/demo', require('./routes/demo'));
  app.use('/api', require('./routes/misc'));


  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}

module.exports = { createApp };
