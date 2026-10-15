const express = require('express');
const orders = require('../orderService');
const simulator = require('../simulator');
const { HttpError } = require('../errors');

const router = express.Router();

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid order id');
  return id;
}

// POST /api/orders
// { buyerId, productId, quantity, deliveryAddress, deliveryPincode, paymentMode, courier? }
router.post('/', (req, res) => {
  res.status(201).json(orders.placeOrder(req.body));
});

// GET /api/orders/earnings?artisanId=3
router.get('/earnings', (req, res) => {
  const aid = req.query.artisanId || req.query.artisan_id;
  res.json(orders.getEarnings(aid));
});

// GET /api/orders?buyerId=2           buyer's "My Orders"
// GET /api/orders?artisanId=3&tab=new artisan dashboard. tab: new | topack | shipped | delivered
router.get('/', (req, res) => {
  const { buyerId, artisanId, tab } = req.query;
  res.json(orders.listOrders({ buyerId, artisanId, tab }));
});

router.get('/:id', (req, res) => {
  res.json(orders.getOrderDetail(idParam(req)));
});

// Printable label data (tracking ID, addresses, QR payload, packing tips)
router.get('/:id/label', (req, res) => {
  res.json(orders.getLabel(idParam(req)));
});

// PATCH /api/orders/:id/confirm   { artisanId }
router.patch('/:id/confirm', (req, res) => {
  res.json(orders.confirm(idParam(req), req.body && req.body.artisanId));
});

// PATCH /api/orders/:id/pack      { artisanId }
// Creates the shipment, then the courier schedules pickup and the timer starts.
router.patch('/:id/pack', (req, res) => {
  const id = idParam(req);
  orders.pack(id, req.body && req.body.artisanId);
  simulator.start(id);
  res.json(orders.getOrderDetail(id));
});

// PATCH or POST /api/orders/:id/handover  { artisanId, handoverCode }
// Verifies 6-digit code for local pickup and marks order DELIVERED
const handleHandover = (req, res) => {
  const id = idParam(req);
  const body = req.body || {};
  const artisanId = body.artisanId || body.artisan_id;
  const handoverCode = body.handoverCode || body.handover_code;
  res.json(orders.confirmHandover(id, artisanId, handoverCode));
};
router.patch('/:id/handover', handleHandover);
router.post('/:id/handover', handleHandover);

// PATCH /api/orders/:id/cancel    { userId, reason? }   only before PICKED_UP
router.patch('/:id/cancel', (req, res) => {
  const body = req.body || {};
  res.json(orders.cancel(idParam(req), body.userId, body.reason));
});

module.exports = router;

