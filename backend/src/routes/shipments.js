const express = require('express');
const { db } = require('../db');
const orders = require('../orderService');
const { STAGES } = require('../statusRules');
const { HttpError } = require('../errors');

const router = express.Router();

// GET /api/shipments/:trackingId
// The buyer's tracking page: shipment, the full timeline in order, and the 8 stages for the progress bar.
router.get('/:trackingId', (req, res) => {
  const shipment = db.prepare('SELECT * FROM shipments WHERE tracking_id = ?').get(req.params.trackingId);
  if (!shipment) throw new HttpError(404, 'Tracking ID not found');

  const { order, events } = orders.getOrderDetail(shipment.order_id);
  res.json({
    shipment,
    order: {
      id: order.id,
      status: order.status,
      product_name: order.product_name,
      delivery_pincode: order.delivery_pincode,
      payment_mode: order.payment_mode,
    },
    events,
    stages: STAGES,
    currentStageIndex: STAGES.indexOf(order.status), // -1 for CANCELLED / DELIVERY_FAILED / RETURNED
  });
});

module.exports = router;
