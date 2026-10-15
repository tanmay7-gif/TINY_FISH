// End-to-end smoke test. Runs against an in-memory database: `npm test`
process.env.DB_PATH = ':memory:';
process.env.AUTO_SIMULATE = 'false';

const assert = require('node:assert/strict');
const config = require('../src/config');
const { reset } = require('../src/db');
const { seedData } = require('../src/seed');
const { createApp } = require('../src/app');
const simulator = require('../src/simulator');
const orders = require('../src/orderService');

reset();
seedData();

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ok  ${name}`);
}

const BUYER = 2; // Delhi
const POTTER = 3; // Jaipur
const PAINTER = 4; // Delhi
const BEATMAKER = 5;

async function orderThrough(productId, extra = {}) {
  const placed = await call('POST', '/orders', {
    buyerId: BUYER, productId, quantity: 1,
    deliveryAddress: '12 Rose Lane, Delhi', deliveryPincode: '110001', paymentMode: 'ONLINE', ...extra,
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  return placed.data;
}

async function run() {
  console.log('Delivery check and rates');
  let r = await call('POST', '/delivery/check', { productId: 2, deliveryPincode: '110001' });
  assert.deepEqual(r.data, { serviceable: true });
  r = await call('POST', '/delivery/check', { productId: 2, deliveryPincode: '999999' });
  assert.equal(r.data.serviceable, false);
  ok('serviceable pincode passes, unknown pincode is blocked');

  r = await call('POST', '/delivery/rates', { productId: 2, deliveryPincode: '110001' });
  assert.equal(r.data.options[0].cost, 70); // 40 + 15*2 slabs (volumetric 0.756kg), same state
  assert.equal(r.data.options[0].etaDays, 3);
  ok('painting Delhi to Delhi costs Rs 70, ETA 3 days');

  r = await call('POST', '/delivery/rates', { productId: 1, deliveryPincode: '110001' });
  assert.equal(r.data.options[0].cost, 155); // 40 + 15*4 slabs (volumetric 2kg) + far 40 + fragile 15
  ok('fragile vase Jaipur to Delhi: volumetric weight, zone and fragile charges');

  r = await call('POST', '/delivery/rates', { productId: 1, deliveryPincode: '110001', paymentMode: 'COD' });
  assert.equal(r.data.options[0].cost, 180); // + COD 25
  ok('COD adds Rs 25');

  r = await call('POST', '/delivery/rates', { productId: 4, deliveryPincode: '110001' });
  assert.equal(r.data.digital, true);
  ok('audio license needs no shipping');

  console.log('Happy path (manual advance)');
  let d = await orderThrough(2);
  const id = d.order.id;
  assert.equal(d.order.status, 'PLACED');
  assert.equal(d.order.shipping_cost, 70);
  assert.equal(d.order.total_price, 899 + 70);
  assert.equal(d.order.platform_fee, 90);
  assert.equal(d.order.creator_payout, 809);
  assert.equal(d.order.payout_status, 'HELD');
  ok('order placed with shipping cost, platform fee and held payout');

  r = await call('PATCH', `/orders/${id}/pack`, { artisanId: PAINTER });
  assert.equal(r.status, 409);
  ok('cannot pack before confirming');

  r = await call('PATCH', `/orders/${id}/confirm`, { artisanId: POTTER });
  assert.equal(r.status, 403);
  ok('wrong artisan cannot confirm');

  r = await call('PATCH', `/orders/${id}/confirm`, { artisanId: PAINTER });
  assert.equal(r.data.order.status, 'CONFIRMED');
  r = await call('PATCH', `/orders/${id}/confirm`, { artisanId: PAINTER });
  assert.equal(r.status, 409);
  ok('confirm works once, second confirm is rejected');

  r = await call('PATCH', `/orders/${id}/pack`, { artisanId: PAINTER });
  assert.equal(r.status, 200);
  assert.equal(r.data.order.status, 'PICKUP_SCHEDULED');
  assert.match(r.data.shipment.tracking_id, /^HNR\d{4}\d{6}$/);
  const tracking = r.data.shipment.tracking_id;
  ok(`pack creates shipment ${tracking} and the courier schedules pickup`);

  r = await call('GET', `/orders/${id}/label`);
  assert.equal(r.data.trackingId, tracking);
  assert.equal(r.data.qrPayload, `HUNAR|${tracking}`);
  ok('shipping label data available');

  r = await call('PATCH', `/orders/${id}/cancel`, { userId: BUYER });
  assert.equal(r.data.order.status, 'CANCELLED');
  ok('cancel allowed at PICKUP_SCHEDULED');

  // fresh order to go all the way
  d = await orderThrough(2);
  const id2 = d.order.id;
  await call('PATCH', `/orders/${id2}/confirm`, { artisanId: PAINTER });
  r = await call('PATCH', `/orders/${id2}/pack`, { artisanId: PAINTER });
  const shipmentId = r.data.shipment.id;

  r = await call('POST', `/demo/advance/${shipmentId}`);
  assert.equal(r.data.order.status, 'PICKED_UP');

  r = await call('PATCH', `/orders/${id2}/cancel`, { userId: BUYER });
  assert.equal(r.status, 409);
  ok('cancel is blocked after PICKED_UP');

  for (const expected of ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    r = await call('POST', `/demo/advance/${shipmentId}`);
    assert.equal(r.data.order.status, expected);
  }
  assert.equal(r.data.order.payout_status, 'RELEASED');
  r = await call('POST', `/demo/advance/${shipmentId}`);
  assert.equal(r.status, 409);
  ok('journey reaches DELIVERED, payout is released, nothing moves after');

  r = await call('GET', `/shipments/${tracking.replace(/\d{6}$/, '000000')}`);
  assert.equal(r.status, 404);
  const t2 = (await call('GET', `/orders/${id2}`)).data.shipment.tracking_id;
  r = await call('GET', `/shipments/${t2}`);
  const statuses = r.data.events.map((e) => e.status);
  assert.deepEqual(statuses, [
    'PLACED', 'CONFIRMED', 'PACKED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED',
  ]);
  assert.equal(r.data.currentStageIndex, 7);
  ok('tracking timeline has all 8 events in order');

  r = await call('GET', `/notifications?userId=${BUYER}`);
  assert.ok(r.data.some((n) => n.message.includes('has been shipped! Track: ' + t2)));
  r = await call('GET', `/notifications?userId=${PAINTER}`);
  assert.ok(r.data.some((n) => n.message.includes('Rs 809 has been released')));
  ok('notifications fired for buyer and artisan');

  console.log('Delivery failed, retry once, then returned');
  d = await orderThrough(3);
  const id3 = d.order.id;
  const stockBefore = (await call('GET', '/products/3')).data.stock;
  await call('PATCH', `/orders/${id3}/confirm`, { artisanId: PAINTER });
  r = await call('PATCH', `/orders/${id3}/pack`, { artisanId: PAINTER });
  const sid3 = r.data.shipment.id;
  for (let i = 0; i < 3; i++) await call('POST', `/demo/advance/${sid3}`); // picked, transit, out
  r = await call('POST', `/demo/fail/${sid3}`);
  assert.equal(r.data.order.status, 'DELIVERY_FAILED');
  r = await call('POST', `/demo/advance/${sid3}`);
  assert.equal(r.data.order.status, 'OUT_FOR_DELIVERY'); // retry
  await call('POST', `/demo/fail/${sid3}`);
  r = await call('POST', `/demo/advance/${sid3}`);
  assert.equal(r.data.order.status, 'RETURNED');
  assert.equal(r.data.order.payout_status, 'VOID');
  assert.equal(r.data.order.payment_status, 'REFUNDED');
  const stockAfter = (await call('GET', '/products/3')).data.stock;
  assert.equal(stockAfter, stockBefore + 1);
  ok('one retry, then RETURNED with refund and restock');

  console.log('Cancel, stock and serviceability edge cases');
  const s0 = (await call('GET', '/products/1')).data.stock;
  d = await orderThrough(1, { deliveryPincode: '400001' });
  assert.equal((await call('GET', '/products/1')).data.stock, s0 - 1);
  await call('PATCH', `/orders/${d.order.id}/cancel`, { userId: BUYER, reason: 'Changed my mind' });
  assert.equal((await call('GET', '/products/1')).data.stock, s0);
  ok('placing reduces stock, cancelling restocks');

  r = await call('POST', '/orders', {
    buyerId: BUYER, productId: 1, quantity: 1, deliveryAddress: 'x', deliveryPincode: '999999', paymentMode: 'ONLINE',
  });
  assert.equal(r.status, 422);
  ok('order to a non-serviceable pincode is blocked at checkout');

  r = await call('POST', '/orders', {
    buyerId: BUYER, productId: 1, quantity: 999, deliveryAddress: 'x', deliveryPincode: '110001',
  });
  assert.equal(r.status, 409);
  ok('out of stock is rejected at placement');

  console.log('Audio license (no courier)');
  d = await call('POST', '/orders', { buyerId: BUYER, productId: 4, paymentMode: 'ONLINE' });
  assert.equal(d.status, 201);
  assert.equal(d.data.order.status, 'DELIVERED');
  assert.equal(d.data.order.payout_status, 'RELEASED');
  assert.equal(d.data.shipment, null);
  assert.ok(d.data.license.downloadUrl);
  ok('license unlocks instantly, payout released, no shipment');
  r = await call('POST', '/orders', { buyerId: BUYER, productId: 4, paymentMode: 'COD' });
  assert.equal(r.status, 400);
  ok('digital items cannot be COD');

  console.log('COD collected on delivery');
  d = await orderThrough(3, { paymentMode: 'COD' });
  assert.equal(d.order.payment_status, 'PENDING');
  assert.equal(d.order.shipping_cost, 95); // 40 + 15*2 slabs (volumetric 0.6kg) + same state 0 + COD 25
  const idc = d.order.id;
  await call('PATCH', `/orders/${idc}/confirm`, { artisanId: PAINTER });
  r = await call('PATCH', `/orders/${idc}/pack`, { artisanId: PAINTER });
  for (let i = 0; i < 4; i++) r = await call('POST', `/demo/advance/${r.data.shipment.id}`);
  assert.equal(r.data.order.status, 'DELIVERED');
  assert.equal(r.data.order.payment_status, 'COLLECTED');
  ok('COD payment marked COLLECTED on delivery');

  console.log('Dashboards and auto-cancel');
  r = await call('GET', `/orders?artisanId=${PAINTER}&tab=delivered`);
  assert.ok(r.data.length >= 2 && r.data.every((o) => o.status === 'DELIVERED'));
  ok('artisan dashboard tabs filter by status');

  d = await orderThrough(2);
  config.AUTO_CANCEL_MINUTES = 0.0001; // ~6ms
  await new Promise((res) => setTimeout(res, 50));
  const cancelled = orders.autoCancelStale();
  assert.ok(cancelled.includes(d.order.id));
  assert.equal((await call('GET', `/orders/${d.order.id}`)).data.order.status, 'CANCELLED');
  config.AUTO_CANCEL_MINUTES = 2880;
  ok('unpacked order is auto-cancelled');

  console.log('Auto-progress timer');
  config.AUTO_SIMULATE = true;
  config.STEP_DELAY_SEC = 0.1;
  d = await orderThrough(2);
  await call('PATCH', `/orders/${d.order.id}/confirm`, { artisanId: PAINTER });
  await call('PATCH', `/orders/${d.order.id}/pack`, { artisanId: PAINTER });
  await new Promise((res) => setTimeout(res, 800));
  r = await call('GET', `/orders/${d.order.id}`);
  assert.equal(r.data.order.status, 'DELIVERED');
  ok('timer drives the shipment to DELIVERED on its own');

  console.log('Showcase & Creator Profiles (Phase 1)');
  // 1. List creators
  let creatorsRes = await call('GET', '/creators');
  assert.equal(creatorsRes.status, 200);
  assert.ok(creatorsRes.data.length >= 5);
  ok('creators list returns seeded creators with preview media and counts');

  // 2. Creator detail
  const meera = creatorsRes.data.find((c) => c.user_id === POTTER);
  assert.ok(meera);
  const cDetail = await call('GET', `/creators/${meera.id}`);
  assert.equal(cDetail.status, 200);
  assert.equal(cDetail.data.display_name, 'Meera Devi');
  assert.ok(cDetail.data.showcase.length >= 2);
  assert.ok(cDetail.data.products.length >= 1);
  ok('creator profile includes showcase items and artisan products');

  // 3. Add showcase item
  const newShowcase = await call('POST', `/creators/${cDetail.data.id}/showcase`, {
    type: 'IMAGE',
    url: 'https://example.com/craft-kiln.jpg',
    title: 'Traditional Wood Kiln',
    description: 'Baking clay pots at 1000 degrees Celsius',
  });
  assert.equal(newShowcase.status, 201);
  assert.equal(newShowcase.data.title, 'Traditional Wood Kiln');
  ok('artisan can add showcase items');

  // 4. Create and edit product
  const newProductRes = await call('POST', '/products', {
    artisan_id: POTTER,
    name: 'Terracotta Planter Pot',
    description: 'Rustic handmade planter',
    kind: 'PHYSICAL',
    price: 450,
    weight_grams: 800,
    length_cm: 15,
    width_cm: 15,
    height_cm: 18,
    fragile: 1,
    stock: 5,
  });
  assert.equal(newProductRes.status, 201);
  assert.equal(newProductRes.data.name, 'Terracotta Planter Pot');
  const createdPid = newProductRes.data.id;

  const updateProd = await call('PUT', `/products/${createdPid}`, { price: 499, stock: 7 });
  assert.equal(updateProd.status, 200);
  assert.equal(updateProd.data.price, 499);
  assert.equal(updateProd.data.stock, 7);
  ok('artisan can create and edit products');

  console.log('Local Pickup & Offline Selling (Phase 2)');
  // 5. Place Local Pickup Order
  const pickupOrderRes = await call('POST', '/orders', {
    buyerId: BUYER,
    productId: createdPid,
    quantity: 1,
    paymentMode: 'ONLINE',
    fulfilmentType: 'LOCAL_PICKUP',
    deliveryAddress: 'Self-pickup at Studio',
  });
  assert.equal(pickupOrderRes.status, 201);
  const pickupOrder = pickupOrderRes.data.order;
  assert.equal(pickupOrder.fulfilment_type, 'LOCAL_PICKUP');
  assert.equal(pickupOrder.shipping_cost, 0);
  assert.equal(pickupOrder.total_price, 499);
  assert.ok(pickupOrder.handover_code && pickupOrder.handover_code.length === 6);
  assert.equal(pickupOrderRes.data.shipment, null);
  ok('local pickup order has zero shipping, no courier, and 6-digit handover code');

  // 6. Confirm and Handover verification
  await call('PATCH', `/orders/${pickupOrder.id}/confirm`, { artisanId: POTTER });

  // Wrong code fails
  const wrongCodeRes = await call('POST', `/orders/${pickupOrder.id}/handover`, {
    artisanId: POTTER,
    handoverCode: '000000',
  });
  assert.equal(wrongCodeRes.status, 400);
  ok('wrong handover code is rejected');

  // Correct code completes handover
  const rightCodeRes = await call('POST', `/orders/${pickupOrder.id}/handover`, {
    artisanId: POTTER,
    handoverCode: pickupOrder.handover_code,
  });
  assert.equal(rightCodeRes.status, 200);
  assert.equal(rightCodeRes.data.order.status, 'DELIVERED');
  assert.equal(rightCodeRes.data.order.payout_status, 'RELEASED');
  ok('valid handover code completes handover, sets DELIVERED, and releases payout');

  // 7. Offline sale
  const offlineSaleRes = await call('POST', `/products/${createdPid}/offline-sale`, {
    artisanId: POTTER,
    quantity: 2,
    salePrice: 450,
    notes: 'Dilli Haat craft stall cash sale',
  });
  assert.equal(offlineSaleRes.status, 201);
  assert.equal(offlineSaleRes.data.sale.total_amount, 900);
  assert.equal(offlineSaleRes.data.product.stock, 4);

  // Check earnings summary
  const earningsRes = await call('GET', `/orders/earnings?artisanId=${POTTER}`);
  assert.equal(earningsRes.status, 200);
  assert.ok(earningsRes.data.releasedPayout > 0);
  assert.ok(earningsRes.data.offlineEarnings >= 900);
  ok('artisan offline sale reduces stock and logs fair/stall earnings');

  console.log('Bad input');
  r = await call('GET', '/orders/abc');
  assert.equal(r.status, 400);
  r = await call('GET', '/nope');
  assert.equal(r.status, 404);
  ok('bad ids and unknown routes return clean errors');
}


run()
  .then(() => {
    console.log(`\nAll ${passed} checks passed.`);
    simulator.stopAll();
    server.close();
  })
  .catch((err) => {
    console.error('\nFAILED:', err.message);
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    simulator.stopAll();
    server.close();
    process.exitCode = 1;
  });
