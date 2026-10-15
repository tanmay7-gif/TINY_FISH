/**
 * Courier simulator: makes the mock courier feel live.
 *
 * After the artisan marks an order PACKED, the courier moves it forward on a timer.
 * advance() is the single step function, used by both the timer and the demo "advance" button.
 * In production a real courier's webhook would call changeStatus() the same way.
 */
const config = require('./config');
const courier = require('./courierService');
const orders = require('./orderService');
const { HttpError } = require('./errors');

// What the courier does next, from each status.
const NEXT_BY_STATUS = {
  PACKED: 'PICKUP_SCHEDULED',
  PICKUP_SCHEDULED: 'PICKED_UP',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'DELIVERED',
};

const timers = new Map();

function nextFor(order, shipment) {
  if (order.status === 'DELIVERY_FAILED') {
    // Retry once, then send the parcel back.
    return shipment.attempts >= 2 ? 'RETURNED' : 'OUT_FOR_DELIVERY';
  }
  return NEXT_BY_STATUS[order.status];
}

function moveTo(orderId, status) {
  const order = orders.getOrder(orderId);
  const shipment = orders.getShipmentByOrder(orderId);
  const event = courier.progress(shipment.tracking_id, status, order);
  return orders.changeStatus(orderId, status, event);
}

/** Move the shipment to its next stage. */
function advance(orderId) {
  const order = orders.getOrder(orderId);
  if (!order) throw new HttpError(404, `Order ${orderId} not found`);
  const shipment = orders.getShipmentByOrder(orderId);
  if (!shipment) throw new HttpError(409, 'No shipment yet. The artisan must pack the order first');

  const next = nextFor(order, shipment);
  if (!next) throw new HttpError(409, `Nothing to advance from ${order.status}`);
  return moveTo(orderId, next);
}

/** Demo helper: make the current delivery attempt fail. */
function failDelivery(orderId) {
  const order = orders.getOrder(orderId);
  if (!order) throw new HttpError(404, `Order ${orderId} not found`);
  if (order.status !== 'OUT_FOR_DELIVERY') {
    throw new HttpError(409, `Delivery can only fail while OUT_FOR_DELIVERY (it is ${order.status})`);
  }
  return moveTo(orderId, 'DELIVERY_FAILED');
}

function schedule(orderId) {
  clearTimeout(timers.get(orderId));
  const t = setTimeout(() => {
    timers.delete(orderId);
    const order = orders.getOrder(orderId);
    if (!order || !NEXT_BY_STATUS[order.status]) return; // delivered, cancelled, failed or returned: stop
    try {
      advance(orderId);
    } catch (err) {
      console.error(`simulator: order ${orderId}:`, err.message);
      return;
    }
    schedule(orderId);
  }, Math.max(0, config.STEP_DELAY_SEC) * 1000);
  timers.set(orderId, t);
}

/** Called right after PACKED. Pickup is scheduled immediately, the rest follows on a timer. */
function start(orderId) {
  advance(orderId); // PACKED -> PICKUP_SCHEDULED, 0 sec
  if (config.AUTO_SIMULATE) schedule(orderId);
}

/** After a server restart, pick up shipments that were mid-journey. */
function resume(db) {
  if (!config.AUTO_SIMULATE) return 0;
  const rows = db
    .prepare("SELECT id FROM orders WHERE status IN ('PICKUP_SCHEDULED','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY')")
    .all();
  rows.forEach((r) => schedule(r.id));
  return rows.length;
}

function stopAll() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

module.exports = { start, advance, failDelivery, resume, stopAll };
