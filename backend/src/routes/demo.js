const express = require('express');
const { db } = require('../db');
const simulator = require('../simulator');
const orders = require('../orderService');
const { HttpError } = require('../errors');

const router = express.Router();

// :shipmentId can be the numeric shipment id or the tracking ID (HNR...).
function orderIdFor(param) {
  const shipment = /^HNR/i.test(param)
    ? db.prepare('SELECT * FROM shipments WHERE tracking_id = ?').get(param)
    : db.prepare('SELECT * FROM shipments WHERE id = ?').get(Number(param));
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  return shipment.order_id;
}

// GET /api/demo/shipments   active shipments for the admin demo panel
router.get('/shipments', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id AS shipment_id, s.tracking_id, s.current_status, s.attempts, o.id AS order_id, p.name AS product_name
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       JOIN products p ON p.id = o.product_id
       WHERE o.status NOT IN ('DELIVERED','CANCELLED','RETURNED')
       ORDER BY s.id DESC`
    )
    .all();
  res.json(rows);
});

// POST /api/demo/advance/:shipmentId   move to the next stage (the "Simulate next step" button)
router.post('/advance/:shipmentId', (req, res) => {
  const orderId = orderIdFor(req.params.shipmentId);
  simulator.advance(orderId);
  res.json(orders.getOrderDetail(orderId));
});

// POST /api/demo/fail/:shipmentId   make the delivery attempt fail (shows the edge case)
router.post('/fail/:shipmentId', (req, res) => {
  const orderId = orderIdFor(req.params.shipmentId);
  simulator.failDelivery(orderId);
  res.json(orders.getOrderDetail(orderId));
});

module.exports = router;
