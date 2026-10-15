const express = require('express');
const { db } = require('../db');
const courier = require('../courierService');
const { HttpError } = require('../errors');

const router = express.Router();

function loadProductAndPickup(productId) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(productId));
  if (!product) throw new HttpError(404, 'Product not found');
  const artisan = db.prepare('SELECT * FROM users WHERE id = ?').get(product.artisan_id);
  return { product, pickupPincode: artisan.pincode };
}

// POST /api/delivery/check   { productId, deliveryPincode }   (or { pickupPincode, deliveryPincode })
// Powers the "Check delivery" box on the product page.
router.post('/check', (req, res) => {
  const { productId, deliveryPincode } = req.body || {};
  let pickupPincode = req.body && req.body.pickupPincode;

  if (productId) {
    const { product, pickupPincode: pickup } = loadProductAndPickup(productId);
    if (product.kind === 'AUDIO') {
      return res.json({ serviceable: true, digital: true, message: 'Digital item: instant download, no shipping' });
    }
    pickupPincode = pickup;
  }
  res.json(courier.checkServiceability(pickupPincode, deliveryPincode));
});

// POST /api/delivery/rates   { productId, quantity, deliveryPincode, paymentMode }
// Returns the shipping options with cost and ETA.
router.post('/rates', (req, res) => {
  const { productId, deliveryPincode } = req.body || {};
  const quantity = Number((req.body && req.body.quantity) || 1);
  const paymentMode = String((req.body && req.body.paymentMode) || 'ONLINE').toUpperCase();

  const { product, pickupPincode } = loadProductAndPickup(productId);
  if (product.kind === 'AUDIO') {
    return res.json({ serviceable: true, digital: true, options: [], message: 'Digital item: instant download, no shipping' });
  }

  const service = courier.checkServiceability(pickupPincode, deliveryPincode);
  if (!service.serviceable) return res.json({ ...service, options: [] });

  const options = courier.getRates(
    pickupPincode,
    deliveryPincode,
    {
      weightGrams: product.weight_grams * quantity,
      lengthCm: product.length_cm,
      widthCm: product.width_cm,
      heightCm: product.height_cm * quantity,
      fragile: !!product.fragile,
    },
    paymentMode === 'COD' ? product.price * quantity : 0
  );
  res.json({ serviceable: true, options });
});

module.exports = router;
