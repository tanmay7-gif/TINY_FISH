/**
 * Mock Courier Service.
 *
 * Same functions a real courier API (Shiprocket, Delhivery) would give us.
 * The rest of the app only talks to this module, so going real later means
 * replacing the bodies in THIS file and nothing else.
 *
 *   checkServiceability -> Shiprocket / Delhivery serviceability API
 *   getRates            -> rate calculator API
 *   createShipment      -> order + AWB creation API
 *   getTrackingStatus   -> tracking API or webhook
 *   cancelShipment      -> cancel API
 */

// Fake but believable: only these pincode prefixes (our demo cities) are served.
const SERVICEABLE_PREFIXES = ['110', '302', '400', '411', '380', '500', '560', '600', '700', '226'];

const CITY_BY_PREFIX = {
  '110': 'Delhi',
  '302': 'Jaipur',
  '400': 'Mumbai',
  '411': 'Pune',
  '380': 'Ahmedabad',
  '500': 'Hyderabad',
  '560': 'Bengaluru',
  '600': 'Chennai',
  '700': 'Kolkata',
  '226': 'Lucknow',
};

const ZONES = {
  SAME_STATE: { charge: 0, days: 3 },
  NEARBY: { charge: 20, days: 5 },
  FAR: { charge: 40, days: 7 },
};

const BASE = 40;
const PER_500G = 15;
const FRAGILE_CHARGE = 15;
const COD_CHARGE = 25;
const POST_DISCOUNT = 0.65; // India Post (mock) is cheaper but slower
const POST_EXTRA_DAYS = 3;

// In-memory view of shipments, like a courier's own system would hold.
const courierRecords = new Map();
const issuedIds = new Set();

function isValidPincode(pin) {
  return /^[1-9][0-9]{5}$/.test(String(pin || ''));
}

function cityOf(pincode) {
  const pin = String(pincode || '');
  return CITY_BY_PREFIX[pin.slice(0, 3)] || `Pincode ${pin}`;
}

function isServed(pincode) {
  const pin = String(pincode || '');
  return SERVICEABLE_PREFIXES.some((p) => pin.startsWith(p));
}

function checkServiceability(pickupPincode, deliveryPincode) {
  if (!isValidPincode(pickupPincode) || !isValidPincode(deliveryPincode)) {
    return { serviceable: false, reason: 'Enter a valid 6-digit pincode' };
  }
  if (!isServed(pickupPincode) || !isServed(deliveryPincode)) {
    return { serviceable: false, reason: 'Delivery is not available to this pincode yet' };
  }
  return { serviceable: true };
}

// Mock zones from pincode digits: same first 2 digits = same state, same first digit = nearby, else far.
function zoneOf(pickupPincode, deliveryPincode) {
  const a = String(pickupPincode);
  const b = String(deliveryPincode);
  if (a.slice(0, 2) === b.slice(0, 2)) return 'SAME_STATE';
  if (a[0] === b[0]) return 'NEARBY';
  return 'FAR';
}

/**
 * parcel: { weightGrams, lengthCm, widthCm, heightCm, fragile }
 * codAmount: > 0 means cash on delivery
 * Returns a list of options, like a real rate API.
 */
function getRates(pickupPincode, deliveryPincode, parcel = {}, codAmount = 0) {
  const { weightGrams = 500, lengthCm = 0, widthCm = 0, heightCm = 0, fragile = false } = parcel;
  const zone = ZONES[zoneOf(pickupPincode, deliveryPincode)];

  const actualKg = weightGrams / 1000;
  const volumetricKg = (lengthCm * widthCm * heightCm) / 5000;
  const chargeableKg = Math.max(actualKg, volumetricKg);
  const slabs = Math.max(1, Math.ceil(chargeableKg / 0.5));

  const express =
    BASE +
    PER_500G * slabs +
    zone.charge +
    (fragile ? FRAGILE_CHARGE : 0) +
    (codAmount > 0 ? COD_CHARGE : 0);

  return [
    { courier: 'Hunar Express', cost: express, etaDays: zone.days },
    { courier: 'India Post (mock)', cost: Math.round(express * POST_DISCOUNT), etaDays: zone.days + POST_EXTRA_DAYS },
  ];
}

function etaDaysFor(courierName, pickupPincode, deliveryPincode) {
  const rates = getRates(pickupPincode, deliveryPincode);
  const match = rates.find((r) => r.courier === courierName) || rates[0];
  return match.etaDays;
}

function newTrackingId() {
  const year = new Date().getFullYear();
  let id;
  do {
    id = `HNR${year}${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`;
  } while (issuedIds.has(id));
  issuedIds.add(id);
  return id;
}

/** order: needs courier_name, pickup_pincode, delivery_pincode */
function createShipment(order) {
  const courier = order.courier_name || 'Hunar Express';
  const days = etaDaysFor(courier, order.pickup_pincode, order.delivery_pincode);
  const eta = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const trackingId = newTrackingId();
  courierRecords.set(trackingId, { status: 'CREATED', events: [] });
  return { trackingId, courier, eta };
}

function getTrackingStatus(trackingId) {
  const rec = courierRecords.get(trackingId);
  if (!rec) return null;
  return { status: rec.status, events: rec.events };
}

function cancelShipment(trackingId) {
  const rec = courierRecords.get(trackingId) || { status: 'CREATED', events: [] };
  rec.status = 'CANCELLED';
  rec.events.push({ status: 'CANCELLED', message: 'Shipment cancelled', timestamp: new Date().toISOString() });
  courierRecords.set(trackingId, rec);
  return { cancelled: true };
}

const MESSAGES = {
  PICKUP_SCHEDULED: 'Pickup scheduled for tomorrow, 10am-1pm',
  PICKED_UP: "Picked up from artisan's location",
  IN_TRANSIT: 'Arrived at sorting hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered to buyer',
  DELIVERY_FAILED: 'Delivery attempt failed: buyer not available',
  RETURNED: 'Returned to artisan',
};

/**
 * The courier moves a shipment to a new stage and tells us the event to show.
 * In production this is what a courier webhook would send us.
 */
function progress(trackingId, status, order) {
  const pickupCity = cityOf(order.pickup_pincode);
  const deliveryCity = cityOf(order.delivery_pincode);

  let message = MESSAGES[status] || status;
  let location = pickupCity;
  if (status === 'IN_TRANSIT') {
    message = `Arrived at sorting hub, ${pickupCity}`;
  }
  if (['OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED'].includes(status)) {
    location = deliveryCity;
  }

  const rec = courierRecords.get(trackingId) || { status: 'CREATED', events: [] };
  rec.status = status;
  rec.events.push({ status, location, message, timestamp: new Date().toISOString() });
  courierRecords.set(trackingId, rec);

  return { message, location };
}

module.exports = {
  checkServiceability,
  getRates,
  createShipment,
  getTrackingStatus,
  cancelShipment,
  // helpers used by the app
  progress,
  cityOf,
  isValidPincode,
};
