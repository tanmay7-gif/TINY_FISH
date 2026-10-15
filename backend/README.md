# Hunar (हुनर) — Hyper-Local Craft & Creative Marketplace

Hunar is a hyper-local platform where talented master artisans (potters, painters, metalworkers, beat makers, singers, performers) showcase their authentic work, get recognized, and sell online or offline.

Delivery is one supporting feature for physical goods sold online.

---

## Quickstart

### 1. Run the Backend (Express + SQLite)
```bash
cd hunar-backend
npm install
npm run seed      # Seeds verified master creators, showcase items, & demo products
STEP_DELAY_SEC=5 npm start   # Starts on http://localhost:4000 (5s delay for fast demo)
```

Run test suite (35 end-to-end checks):
```bash
npm test
```

### 2. Run the Frontend (React + Vite + Tailwind)
In a second terminal:
```bash
cd frontend
npm install
npm run dev       # Starts on http://localhost:5173
```

Visit **http://localhost:5173** in your browser.

---

## 2-Minute Demo Script

Follow this sequence to demo the full platform flow:

1. **Discover Talent (Buyer)**:
   - Switch top-bar persona to **Aarav (Buyer, Delhi)**.
   - Browse categories (Pottery & Clay, Folk Painting, Audio & Beats).
   - Click on **Meera Devi (Jaipur Blue Pottery)**. Watch her studio wheel-throwing video reel and view her Persian ceramic vase.

2. **Delivery Check & Checkout**:
   - Click on **Blue Pottery Vase**.
   - In the "Check Delivery" box, enter pincode `110001` (Delhi). Live rates and ETAs appear for **Hunar Express** and **India Post**.
   - Click **Checkout**. Choose **Courier Delivery** (or choose **Local Pickup** with 0 shipping cost and a 6-digit handover code).
   - Select **Online Payment** and click **Confirm & Place Order**.

3. **Artisan Studio Dashboard**:
   - Switch top-bar persona to **Meera Devi (Artisan)**.
   - Open the **Orders Dashboard**. The new order appears under **New Orders**.
   - Click the big **Accept & Confirm** button.
   - Click **Mark Packed & Ready**. Click **Print Shipping Label** to view the printable sheet with QR code, fragile caution, and addresses.

4. **Live Logistics & Escrow Payout**:
   - Switch back to **Aarav (Buyer)** and open **My Orders & Tracking**.
   - Watch the 8-stage progress bar advance live (`STEP_DELAY_SEC=5`) from Pickup Scheduled &rarr; Picked Up &rarr; In Transit &rarr; Out For Delivery &rarr; Delivered.
   - Click the **Bell Icon** to inspect the simulated SMS and push notification feed.
   - Switch back to **Meera Devi** to see the held payout status immediately shift to **Released** (₹1,169 in wallet).

5. **Offline Stall & Fair Sales**:
   - In Meera's dashboard, click **+ Record Stall / Mela Sale**. Enter quantity sold in cash at Dilli Haat. Notice product stock drops immediately and earnings log to her offline revenue ledger without fees.

---

## How it Fits the Hunar Spec

| Spec Requirement | How Hunar Implements It |
|---|---|
| **Physical Goods (BuyMe)** | Full order lifecycle: courier serviceability check, shipment creation, tracking ID, and 8-stage timeline. |
| **Local Studio Pickup** | Zero shipping cost (`fulfilment_type: 'LOCAL_PICKUP'`), generates 6-digit handover code. Artisan verifies code on delivery. |
| **Offline Fair Sales** | `POST /api/products/:id/offline-sale` reduces stock and logs cash earnings from craft melas/stalls. |
| **Audio Licenses** | `AUDIO` products bypass the courier; order is marked `DELIVERED` instantly with license contract and download URL. |
| **Platform Fee** | Platform retains 10% fee (`PLATFORM_FEE_PCT`); 90% is allocated to `creator_payout`. |
| **Escrow Safety** | `payout_status` is `HELD` during transit, becomes `RELEASED` upon confirmed delivery or verified handover, and `VOID` on cancel. |

---

## Order Lifecycle

```
COURIER FLOW:
PLACED -> CONFIRMED -> PACKED -> PICKUP_SCHEDULED -> PICKED_UP
       -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED
Side states: CANCELLED (only before PICKED_UP), DELIVERY_FAILED (retry once) -> RETURNED

LOCAL PICKUP FLOW:
PLACED -> CONFIRMED -> (READY / PACKED) -> [6-digit Handover Code Verified] -> DELIVERED
```

Every status change passes strictly through `changeStatus()` in `src/orderService.js` and validates against `src/statusRules.js`.

---

## API Reference

Base URL: `http://localhost:4000/api`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/creators` | List creators with showcase and product counts |
| `GET` | `/creators/:id` | Creator profile, video/photo showcase items, and products |
| `POST` | `/creators` | Create new creator profile |
| `PUT` | `/creators/:id` | Update creator profile |
| `POST` | `/creators/:id/showcase` | Add video or photo showcase item (supports file upload via multer) |
| `GET` | `/products` | List products (filterable by `kind` and `artisanId`) |
| `POST` | `/products` | List new physical product or audio license |
| `PUT` | `/products/:id` | Update product price, stock, or attributes |
| `POST` | `/products/:id/offline-sale` | Record in-person cash sale at mela/stall |
| `POST` | `/delivery/rates` | Calculate courier shipping rates and ETAs |
| `POST` | `/orders` | Place order (`fulfilmentType: 'COURIER' \| 'LOCAL_PICKUP' \| 'DIGITAL'`) |
| `GET` | `/orders?buyerId=2` | Buyer order history |
| `GET` | `/orders?artisanId=3&tab=new` | Artisan dashboard orders filtered by tab |
| `PATCH` | `/orders/:id/confirm` | Artisan confirms order |
| `PATCH` | `/orders/:id/pack` | Artisan marks packed (creates shipment & starts timer) |
| `PATCH` | `/orders/:id/handover` | Verifies 6-digit code for local pickup and marks `DELIVERED` |
| `GET` | `/orders/earnings?artisanId=3` | Held, released, and offline earnings summary |
| `GET` | `/orders/:id/label` | Printable shipping label data with `qrPayload` |
| `GET` | `/demo/shipments` | Active shipments for pitch control |
| `POST` | `/demo/advance/:id` | Move courier to next stage manually |
| `POST` | `/demo/fail/:id` | Trigger delivery attempt failure |

---

## Production Readiness: Mocked Parts vs Real Services

Everything in this demo is deliberately self-contained with no external API keys required:

| Component | In This Repository (Mocked) | Production Replacement |
|---|---|---|
| **Courier Logistics** | `src/courierService.js` & `src/simulator.js` (Deterministic timers & formula rates) | **Shiprocket API** or **Delhivery Direct API** with webhook status callbacks. |
| **SMS & Push Alerts** | `src/notify.js` (In-app notification table & simulated phone drawer) | **Twilio SMS** or **WhatsApp Business API** (Interakt/Gupshup). |
| **Payment Gateway** | Internal mock state (`ONLINE` / `COD`, held escrow) | **Razorpay Route** or **Cashfree Split Payments** for automated creator escrow releases. |
| **Media Storage** | Local disk storage via `multer` into `/uploads` | **AWS S3** or **Cloudflare R2** with CloudFront CDN. |

---

## Coming Soon Community Pillars

The following features have prominent **Coming Soon** exploration previews in the UI:
1. **BookMe Live Services**: Hire mehndi artists, Rajasthani folk singers, Sarangi players, and photographers directly for weddings and events.
2. **Opportunity Board**: Curated listings for government craft mela stalls (Dilli Haat, Surajkund), state emporium tenders, and corporate gifting commissions.
3. **Master-Apprentice Mentorship**: Structured apprenticeships directly under Padma Shri and National Awardee master artisans.
4. **Artisan Career Roadmap**: Stage-by-stage accreditation, GI Tag certification assistance, and export-readiness tools.
