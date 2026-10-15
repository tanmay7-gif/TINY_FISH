const { db } = require('./db');
const config = require('./config');
const courier = require('./courierService');
const { canMove } = require('./statusRules');
const { notify } = require('./notify');
const { HttpError } = require('./errors');

const now = () => new Date().toISOString();

const ORDER_SELECT = `
  SELECT o.*, p.name AS product_name, p.kind AS product_kind, p.fragile AS product_fragile,
         b.name AS buyer_name, a.name AS artisan_name
  FROM orders o
  JOIN products p ON p.id = o.product_id
  JOIN users b ON b.id = o.buyer_id
  JOIN users a ON a.id = o.artisan_id`;

const DEFAULT_MESSAGES = {
  PLACED: 'Order placed',
  CONFIRMED: 'Artisan confirmed your order',
  PACKED: 'Order packed and ready for pickup',
  PICKUP_SCHEDULED: 'Pickup scheduled for tomorrow, 10am-1pm',
  PICKED_UP: "Picked up from artisan's location",
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered to buyer',
  DELIVERY_FAILED: 'Delivery attempt failed',
  RETURNED: 'Returned to artisan',
  CANCELLED: 'Order cancelled',
};

function getOrder(orderId) {
  return db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId);
}

function getOrderOrThrow(orderId) {
  const order = getOrder(orderId);
  if (!order) throw new HttpError(404, `Order ${orderId} not found`);
  return order;
}

function getShipmentByOrder(orderId) {
  return db.prepare('SELECT * FROM shipments WHERE order_id = ?').get(orderId);
}

function getOrderDetail(orderId) {
  const order = getOrderOrThrow(orderId);
  const shipment = getShipmentByOrder(orderId) || null;
  const events = db.prepare('SELECT * FROM tracking_events WHERE order_id = ? ORDER BY id').all(orderId);
  return { order, shipment, events };
}

const TABS = {
  new: ['PLACED'],
  topack: ['CONFIRMED'],
  shipped: ['PACKED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'],
  delivered: ['DELIVERED'],
};

function listOrders({ buyerId, artisanId, tab } = {}) {
  const where = [];
  const params = [];
  if (buyerId) { where.push('o.buyer_id = ?'); params.push(Number(buyerId)); }
  if (artisanId) { where.push('o.artisan_id = ?'); params.push(Number(artisanId)); }
  if (tab) {
    const statuses = TABS[tab];
    if (!statuses) throw new HttpError(400, `Unknown tab "${tab}". Use: ${Object.keys(TABS).join(', ')}`);
    where.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  const sql = `${ORDER_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC`;
  return db.prepare(sql).all(...params);
}

function addEvent(order, shipment, status, location, message) {
  const timestamp = now();
  db.prepare(
    'INSERT INTO tracking_events (order_id, shipment_id, status, location, message, timestamp) VALUES (?,?,?,?,?,?)'
  ).run(order.id, shipment ? shipment.id : null, status, location || null, message || null, timestamp);
  return { status, location, message, timestamp };
}

function defaultLocation(order, status) {
  if (['OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'].includes(status)) {
    return courier.cityOf(order.delivery_pincode);
  }
  return courier.cityOf(order.pickup_pincode);
}

function sendNotifications(order, shipment, status, event) {
  const id = order.id;
  const name = order.product_name;
  const track = shipment ? shipment.tracking_id : '';
  const isPickup = order.fulfilment_type === 'LOCAL_PICKUP';

  const buyerMsg = {
    PLACED: isPickup
      ? `Your Hunar order #${id} for ${name} is placed for local pickup. Handover code: ${order.handover_code}`
      : `Your Hunar order #${id} for ${name} is placed.`,
    CONFIRMED: isPickup
      ? `Good news! The artisan confirmed your Hunar order #${id}. Preparing for your pickup.`
      : `Good news! The artisan confirmed your Hunar order #${id}.`,
    PACKED: isPickup
      ? `Your Hunar order #${id} is ready for pickup! Show code ${order.handover_code} upon collection.`
      : `Your Hunar order #${id} is packed and waiting for pickup. Tracking ID: ${track}`,
    PICKUP_SCHEDULED: `Pickup scheduled for your Hunar order #${id}.`,
    PICKED_UP: `Your Hunar order #${id} has been shipped! Track: ${track}`,
    IN_TRANSIT: `Your Hunar order #${id} is on its way. ${event.message}`,
    OUT_FOR_DELIVERY: `Your Hunar order #${id} is out for delivery today. Track: ${track}`,
    DELIVERED: isPickup
      ? `Your Hunar order #${id} was handed over. Enjoy your ${name}!`
      : `Your Hunar order #${id} was delivered. Enjoy your ${name}!`,
    DELIVERY_FAILED: `We could not deliver your Hunar order #${id}. We will try again.`,
    RETURNED: `Your Hunar order #${id} was returned to the artisan. Your payment will be refunded.`,
    CANCELLED: `Your Hunar order #${id} was cancelled. ${event.message}`,
  }[status];

  const artisanMsg = {
    PLACED: isPickup
      ? `New local pickup order #${id}: ${order.quantity} x ${name}. Please confirm and prepare it.`
      : `New order #${id}: ${order.quantity} x ${name}. Please confirm it.`,
    CONFIRMED: isPickup
      ? `Order #${id} confirmed. Keep it ready for buyer handover.`
      : undefined,
    PACKED: isPickup
      ? `Order #${id} marked ready for handover. Ask the buyer for the 6-digit handover code.`
      : undefined,
    PICKUP_SCHEDULED: `Pickup scheduled for order #${id}. Please keep the parcel ready.`,
    PICKED_UP: `Order #${id} was picked up by the courier.`,
    DELIVERED: isPickup
      ? `Order #${id} was handed over to buyer. Rs ${order.creator_payout} has been released to you.`
      : `Order #${id} was delivered. Rs ${order.creator_payout} has been released to you.`,
    DELIVERY_FAILED: `Delivery of order #${id} failed. The courier will retry.`,
    RETURNED: `Order #${id} is returning to you.`,
    CANCELLED: `Order #${id} was cancelled. ${event.message}`,
  }[status];

  if (buyerMsg) notify(order.buyer_id, buyerMsg);
  if (artisanMsg) notify(order.artisan_id, artisanMsg);
}

/**
 * The ONE place an order status changes.
 * Validates the move, updates order and shipment, writes a tracking event,
 * handles money and stock side effects, and sends notifications.
 */
function changeStatus(orderId, newStatus, opts = {}) {
  const run = db.transaction(() => {
    const order = getOrderOrThrow(orderId);
    if (!canMove(order.status, newStatus, order.fulfilment_type)) {
      throw new HttpError(409, `Cannot move order from ${order.status} to ${newStatus}`);
    }
    const shipment = getShipmentByOrder(orderId);

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(newStatus, orderId);
    if (shipment) {
      const attempts = shipment.attempts + (newStatus === 'OUT_FOR_DELIVERY' ? 1 : 0);
      db.prepare('UPDATE shipments SET current_status = ?, attempts = ? WHERE id = ?').run(newStatus, attempts, shipment.id);
    }

    if (newStatus === 'DELIVERED') {
      db.prepare("UPDATE orders SET payout_status = 'RELEASED' WHERE id = ?").run(orderId);
      if (order.payment_mode === 'COD') {
        db.prepare("UPDATE orders SET payment_status = 'COLLECTED' WHERE id = ?").run(orderId);
      }
    }

    if (newStatus === 'CANCELLED' || newStatus === 'RETURNED') {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(order.quantity, order.product_id);
      db.prepare("UPDATE orders SET payout_status = 'VOID' WHERE id = ?").run(orderId);
      if (order.payment_status === 'PAID') {
        db.prepare("UPDATE orders SET payment_status = 'REFUNDED' WHERE id = ?").run(orderId);
      }
    }

    const message = opts.message || DEFAULT_MESSAGES[newStatus] || newStatus;
    const location = opts.location || defaultLocation(order, newStatus);
    const event = addEvent(order, shipment, newStatus, location, message);

    sendNotifications(getOrderOrThrow(orderId), shipment, newStatus, event);
    return event;
  });

  const event = run();
  return { order: getOrderOrThrow(orderId), event };
}

/**
 * Place an order.
 * PHYSICAL goods:
 *   - COURIER: stock check, serviceability check, shipping cost, then PLACED.
 *   - LOCAL_PICKUP: stock check, no courier, 0 shipping, 6-digit handover code, then PLACED.
 * AUDIO licenses: DIGITAL: no courier. Payment unlocks the download straight away.
 */
function placeOrder(input = {}) {
  const { buyerId, productId } = input;
  const quantity = input.quantity === undefined ? 1 : Number(input.quantity);
  const paymentMode = String(input.paymentMode || 'ONLINE').toUpperCase();

  if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'quantity must be a whole number, 1 or more');
  if (!['ONLINE', 'COD'].includes(paymentMode)) throw new HttpError(400, 'paymentMode must be ONLINE or COD');

  const buyer = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'BUYER'").get(Number(buyerId));
  if (!buyer) throw new HttpError(404, 'Buyer not found');
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(productId));
  if (!product) throw new HttpError(404, 'Product not found');
  const artisan = db.prepare('SELECT * FROM users WHERE id = ?').get(product.artisan_id);

  const itemsTotal = product.price * quantity;
  const platformFee = Math.round((itemsTotal * config.PLATFORM_FEE_PCT) / 100);
  const creatorPayout = itemsTotal - platformFee;

  // Digital goods: no shipment, instant unlock.
  if (product.kind === 'AUDIO') {
    if (quantity !== 1) throw new HttpError(400, 'A license is bought one at a time');
    if (paymentMode === 'COD') throw new HttpError(400, 'Digital items must be paid online');

    const orderId = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO orders (buyer_id, artisan_id, product_id, quantity, items_total, shipping_cost, total_price,
           platform_fee, creator_payout, payout_status, payment_mode, payment_status, status, created_at, fulfilment_type)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'DIGITAL')`
      ).run(buyer.id, artisan.id, product.id, 1, itemsTotal, 0, itemsTotal, platformFee, creatorPayout,
        'RELEASED', 'ONLINE', 'PAID', 'DELIVERED', now());
      const id = Number(info.lastInsertRowid);
      const order = getOrderOrThrow(id);
      addEvent(order, null, 'PLACED', 'Online', 'Order placed');
      addEvent(order, null, 'DELIVERED', 'Online', 'License unlocked. Download is ready.');
      notify(buyer.id, `Your license for ${product.name} is unlocked. Download: ${product.download_url}`);
      notify(artisan.id, `License sold: ${product.name}. Rs ${creatorPayout} released to you.`);
      return id;
    })();

    return { ...getOrderDetail(orderId), license: { downloadUrl: product.download_url } };
  }

  // Physical goods
  if (product.stock < quantity) {
    throw new HttpError(409, product.stock > 0 ? `Only ${product.stock} left in stock` : 'Out of stock');
  }

  const requestedFulfilment = String(input.fulfilmentType || input.fulfilment_type || 'COURIER').toUpperCase();

  // LOCAL_PICKUP flow: No courier, zero shipping, 6-digit code
  if (requestedFulfilment === 'LOCAL_PICKUP') {
    const handoverCode = String(Math.floor(100000 + Math.random() * 900000));
    const pickupHubId = input.pickupHubId || input.pickup_hub_id || null;
    const pickupPincode = artisan.pincode;
    const deliveryAddress = input.deliveryAddress
      ? String(input.deliveryAddress).trim()
      : (pickupHubId ? 'Pickup at Community Hub' : "Artisan Studio / Workshop Handover");
    const deliveryPincode = input.deliveryPincode ? String(input.deliveryPincode).trim() : pickupPincode;

    const orderId = db.transaction(() => {
      const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(quantity, product.id, quantity);
      if (dec.changes !== 1) throw new HttpError(409, 'Out of stock');

      const info = db.prepare(
        `INSERT INTO orders (buyer_id, artisan_id, product_id, quantity, items_total, shipping_cost, total_price,
           platform_fee, creator_payout, payout_status, payment_mode, payment_status, courier_name,
           delivery_address, delivery_pincode, pickup_pincode, status, created_at,
           fulfilment_type, handover_code, pickup_hub_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'LOCAL_PICKUP', ?, ?)`
      ).run(
        buyer.id, artisan.id, product.id, quantity, itemsTotal, 0, itemsTotal,
        platformFee, creatorPayout, 'HELD', paymentMode, paymentMode === 'ONLINE' ? 'PAID' : 'PENDING',
        'Local Pickup', deliveryAddress, deliveryPincode, pickupPincode, 'PLACED', now(),
        handoverCode, pickupHubId
      );

      const id = Number(info.lastInsertRowid);
      const order = getOrderOrThrow(id);
      const event = addEvent(order, null, 'PLACED', courier.cityOf(pickupPincode) || 'Local Studio', `Local pickup order placed. Handover code: ${handoverCode}`);
      sendNotifications(order, null, 'PLACED', event);
      return id;
    })();

    return { ...getOrderDetail(orderId), handover_code: handoverCode };
  }

  // COURIER flow
  const { deliveryAddress, deliveryPincode } = input;
  if (!deliveryAddress || !String(deliveryAddress).trim()) throw new HttpError(400, 'deliveryAddress is required');
  if (!courier.isValidPincode(deliveryPincode)) throw new HttpError(400, 'Enter a valid 6-digit delivery pincode');

  const pickupPincode = artisan.pincode;
  const service = courier.checkServiceability(pickupPincode, deliveryPincode);
  if (!service.serviceable) throw new HttpError(422, service.reason);

  const rates = courier.getRates(
    pickupPincode,
    deliveryPincode,
    {
      weightGrams: product.weight_grams * quantity,
      lengthCm: product.length_cm,
      widthCm: product.width_cm,
      heightCm: product.height_cm * quantity,
      fragile: !!product.fragile,
    },
    paymentMode === 'COD' ? itemsTotal : 0
  );
  const chosen = input.courier ? rates.find((r) => r.courier === input.courier) : rates[0];
  if (!chosen) throw new HttpError(400, `Unknown courier option. Choose one of: ${rates.map((r) => r.courier).join(', ')}`);

  const orderId = db.transaction(() => {
    const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(quantity, product.id, quantity);
    if (dec.changes !== 1) throw new HttpError(409, 'Out of stock');

    const info = db.prepare(
      `INSERT INTO orders (buyer_id, artisan_id, product_id, quantity, items_total, shipping_cost, total_price,
         platform_fee, creator_payout, payout_status, payment_mode, payment_status, courier_name,
         delivery_address, delivery_pincode, pickup_pincode, status, created_at, fulfilment_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'COURIER')`
    ).run(buyer.id, artisan.id, product.id, quantity, itemsTotal, chosen.cost, itemsTotal + chosen.cost,
      platformFee, creatorPayout, 'HELD', paymentMode, paymentMode === 'ONLINE' ? 'PAID' : 'PENDING',
      chosen.courier, String(deliveryAddress).trim(), String(deliveryPincode), pickupPincode, 'PLACED', now());

    const id = Number(info.lastInsertRowid);
    const order = getOrderOrThrow(id);
    const event = addEvent(order, null, 'PLACED', courier.cityOf(pickupPincode), DEFAULT_MESSAGES.PLACED);
    sendNotifications(order, null, 'PLACED', event);
    return id;
  })();

  return { ...getOrderDetail(orderId), eta_days: chosen.etaDays };
}


function assertArtisanOwns(order, artisanId) {
  if (artisanId !== undefined && artisanId !== null && Number(artisanId) !== order.artisan_id) {
    throw new HttpError(403, 'This order belongs to a different artisan');
  }
}

function confirm(orderId, artisanId) {
  const order = getOrderOrThrow(orderId);
  assertArtisanOwns(order, artisanId);
  changeStatus(orderId, 'CONFIRMED');
  return getOrderDetail(orderId);
}

/** Artisan marks packed: creates the shipment (tracking ID) and moves the order to PACKED. */
function pack(orderId, artisanId) {
  const order = getOrderOrThrow(orderId);
  assertArtisanOwns(order, artisanId);
  if (order.status !== 'CONFIRMED') {
    throw new HttpError(409, `Order must be CONFIRMED before packing (it is ${order.status})`);
  }

  db.transaction(() => {
    const s = courier.createShipment(order);
    db.prepare(
      `INSERT INTO shipments (order_id, courier_name, tracking_id, estimated_delivery_date, current_status, attempts, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(orderId, s.courier, s.trackingId, s.eta, 'CONFIRMED', 0, now());
    changeStatus(orderId, 'PACKED', { message: `Packed and handed over for pickup. Tracking ID ${s.trackingId}` });
  })();

  return getOrderDetail(orderId);
}

/** Cancel is only allowed before PICKED_UP. Restocks the item and notifies both sides. */
function cancel(orderId, userId, reason) {
  const order = getOrderOrThrow(orderId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!user) throw new HttpError(404, 'User not found');
  const allowed = user.role === 'ADMIN' || user.id === order.buyer_id || user.id === order.artisan_id;
  if (!allowed) throw new HttpError(403, 'You cannot cancel this order');

  if (!canMove(order.status, 'CANCELLED')) {
    throw new HttpError(409, `Order cannot be cancelled once it is ${order.status}`);
  }

  const shipment = getShipmentByOrder(orderId);
  if (shipment) courier.cancelShipment(shipment.tracking_id);

  const who = user.id === order.buyer_id ? 'buyer' : user.id === order.artisan_id ? 'artisan' : 'admin';
  changeStatus(orderId, 'CANCELLED', { message: reason || `Cancelled by ${who}` });
  return getOrderDetail(orderId);
}

/** Edge case: artisan does not pack within the window. Run on a timer from server.js. */
function autoCancelStale() {
  if (!(config.AUTO_CANCEL_MINUTES > 0)) return [];
  const cutoff = new Date(Date.now() - config.AUTO_CANCEL_MINUTES * 60 * 1000).toISOString();
  const rows = db.prepare("SELECT id FROM orders WHERE status IN ('PLACED','CONFIRMED') AND created_at < ?").all(cutoff);
  const cancelled = [];
  for (const row of rows) {
    try {
      changeStatus(row.id, 'CANCELLED', { message: 'Auto-cancelled: the artisan did not pack the order in time' });
      cancelled.push(row.id);
    } catch (err) {
      console.error(`auto-cancel failed for order ${row.id}:`, err.message);
    }
  }
  return cancelled;
}

/** Printable shipping label data. The frontend renders the QR code from qrPayload. */
function getLabel(orderId) {
  const { order, shipment } = getOrderDetail(orderId);
  if (!shipment) throw new HttpError(409, 'The shipping label is available once the order is packed');

  const artisan = db.prepare('SELECT * FROM users WHERE id = ?').get(order.artisan_id);
  const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(order.buyer_id);
  const fragile = !!order.product_fragile;

  return {
    trackingId: shipment.tracking_id,
    courier: shipment.courier_name,
    estimatedDelivery: shipment.estimated_delivery_date,
    qrPayload: `HUNAR|${shipment.tracking_id}`,
    from: { name: artisan.name, pincode: order.pickup_pincode, city: courier.cityOf(order.pickup_pincode) },
    to: {
      name: buyer.name,
      address: order.delivery_address,
      pincode: order.delivery_pincode,
      city: courier.cityOf(order.delivery_pincode),
    },
    item: order.product_name,
    quantity: order.quantity,
    paymentMode: order.payment_mode,
    collectOnDelivery: order.payment_mode === 'COD' ? order.total_price : 0,
    fragile,
    packingTips: fragile
      ? ['Wrap in bubble wrap, at least two layers', 'Use a sturdy box with padding on every side', 'Stick a "Handle with care" label on top']
      : ['Use a clean, dry box or pouch', 'Add the artisan story card inside the parcel'],
  };
}

/** Confirms local pickup handover using 6-digit code provided by buyer */
function confirmHandover(orderId, artisanId, handoverCode) {
  const order = getOrderOrThrow(orderId);
  assertArtisanOwns(order, artisanId);

  if (order.fulfilment_type !== 'LOCAL_PICKUP') {
    throw new HttpError(400, 'Handover code verification is only valid for LOCAL_PICKUP orders');
  }

  if (!handoverCode || String(order.handover_code).trim() !== String(handoverCode).trim()) {
    throw new HttpError(400, 'Invalid handover code');
  }

  if (order.status === 'DELIVERED') {
    throw new HttpError(409, 'Order is already delivered');
  }

  if (!['CONFIRMED', 'PACKED'].includes(order.status)) {
    throw new HttpError(409, `Order cannot be handed over while ${order.status}`);
  }

  changeStatus(orderId, 'DELIVERED', {
    location: courier.cityOf(order.pickup_pincode) || 'Local Studio',
    message: 'Handover code verified. Handed over to buyer.',
  });

  return getOrderDetail(orderId);
}

/** Calculates an artisan's held payouts, released payouts, and offline sales earnings */
function getEarnings(artisanId) {
  const aid = Number(artisanId);
  if (!aid) throw new HttpError(400, 'artisanId is required');

  const heldRow = db.prepare("SELECT COALESCE(SUM(creator_payout), 0) AS total FROM orders WHERE artisan_id = ? AND payout_status = 'HELD'").get(aid);
  const releasedRow = db.prepare("SELECT COALESCE(SUM(creator_payout), 0) AS total FROM orders WHERE artisan_id = ? AND payout_status = 'RELEASED'").get(aid);
  const offlineRow = db.prepare("SELECT COALESCE(SUM(total_amount), 0) AS total FROM offline_sales WHERE artisan_id = ?").get(aid);
  const offlineCount = db.prepare("SELECT COUNT(*) AS count FROM offline_sales WHERE artisan_id = ?").get(aid);

  return {
    heldPayout: heldRow ? heldRow.total : 0,
    releasedPayout: releasedRow ? releasedRow.total : 0,
    offlineEarnings: offlineRow ? offlineRow.total : 0,
    totalEarnings: (releasedRow ? releasedRow.total : 0) + (offlineRow ? offlineRow.total : 0),
    offlineSalesCount: offlineCount ? offlineCount.count : 0,
  };
}

module.exports = {
  getOrder,
  getOrderDetail,
  getShipmentByOrder,
  listOrders,
  placeOrder,
  confirm,
  pack,
  cancel,
  changeStatus,
  autoCancelStale,
  getLabel,
  confirmHandover,
  getEarnings,
  TABS,
};

