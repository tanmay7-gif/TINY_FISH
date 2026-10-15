// Allowed order status transitions. Nothing skips, nothing goes backwards.
// Every status change in the app goes through changeStatus() in orderService.js, which checks this list.
const NEXT = {
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKED', 'CANCELLED'],
  PACKED: ['PICKUP_SCHEDULED', 'CANCELLED'],
  PICKUP_SCHEDULED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'RETURNED'],
};

// The 8 stages shown on the buyer's progress bar, in order.
const STAGES = [
  'PLACED',
  'CONFIRMED',
  'PACKED',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

const SIDE_STATES = ['CANCELLED', 'DELIVERY_FAILED', 'RETURNED'];
const TERMINAL = ['DELIVERED', 'CANCELLED', 'RETURNED'];

function canMove(from, to, fulfilmentType = 'COURIER') {
  if (fulfilmentType === 'LOCAL_PICKUP') {
    if (from === 'CONFIRMED' && to === 'DELIVERED') return true;
    if (from === 'PACKED' && to === 'DELIVERED') return true;
  }
  return (NEXT[from] || []).includes(to);
}

module.exports = { NEXT, STAGES, SIDE_STATES, TERMINAL, canMove };

