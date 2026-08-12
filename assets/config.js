// ============================================================
//  I SERVED TRANSPORTATION - SETTINGS
//  The only file you edit for contact info + pricing.
// ============================================================
window.CONFIG = {
  COMPANY: "I Served Transportation",
  PHONE_DISPLAY: "(757) 806-8218",
  PHONE_TEL: "7578068218",
  EMAIL: "DFlanagan@IServedTransport.com",
  AREA: "Inland Empire, CA",
  EST_YEAR: 2018,

  // ---------------- FIREBASE (live database + logins) ----------------
  FIREBASE: {
    apiKey: "AIzaSyDNQDWoXBZOP78-Fjld34wb2uKnC8RyNew",
    authDomain: "iserved.firebaseapp.com",
    projectId: "iserved",
    storageBucket: "iserved.firebasestorage.app",
    messagingSenderId: "641810721894",
    appId: "1:641810721894:web:de0d925183f6093ccf51a7"
  },

  // ---------------- EMAIL ALERTS ----------------
  // Free, keyless email via FormSubmit. One-time activation: the first
  // email sent to this address arrives as a "confirm" link - click it once
  // and every alert after that goes straight through.
  NOTIFY_EMAIL: "DFlanagan@IServedTransport.com",

  // ---------------- PRICING ----------------
  // Three service tiers. Fare = base + (miles x per-mile rate).
  //   Ambulatory (sedan):  no base fare, $1.50 per mile
  //   Wheelchair (van):    $25.00 base,  $2.50 per mile
  //   Stretcher (gurney):  $125.00 base, $3.50 per mile
  // Round trips bill both legs (base x2 and all miles counted).
  FREE_MILES: 0,
  BASE:     { sedan: 0,    wav: 25,   stretcher: 125 },
  PER_MILE: { sedan: 1.50, wav: 2.50, stretcher: 3.50 },
  ROUND_TRIP_MULTIPLIER: 2,

  // Wait time: first hour free, then per additional 30 min
  WAIT_FREE_MINUTES: 60,
  WAIT_PER_30MIN: 15,

  // Cancellation
  LATE_CANCEL_FEE: 20,

  // Optional add-ons (0 = hidden from the estimate)
  ADDON_ASSIST: 0,
  ADDON_AFTERHOURS: 0,

  // ---------------- SERVICE TYPES ----------------
  // What the customer picks when booking. Each one maps to a price tier.
  SERVICE_TYPES: [
    { id: "ambulatory", label: "Ambulatory (sedan)",              vehicle: "sedan",     note: "Walks with little or no help" },
    { id: "wheelchair", label: "Wheelchair-accessible van",       vehicle: "wav",       note: "Ramp and securement" },
    { id: "stretcher",  label: "Stretcher / gurney transport",    vehicle: "stretcher", note: "Lying down, two attendants" }
  ],

  // ---------------- STRIPE (card payments) ----------------
  // The publishable key is meant to be public - it can only start a
  // payment, never move money on its own. The SECRET key must never
  // appear in this file or anywhere in the site; it lives in the
  // Cloudflare Worker. See README.txt.
  STRIPE_PUBLISHABLE_KEY: "pk_live_51U3fgeAeWrRbLte2C7eI1LwgObSvLrNIXJ1vNvByJ6yd7CO41906Iyz7crtGzLL4apl4d7LJVCwBCtNpcSyUg2eZ00nxl9RnAd",
  // Filled in once the Worker is deployed, e.g. "https://iserved-pay.<name>.workers.dev"
  PAYMENT_API: "",

  // ---------------- DRIVER PAY ----------------
  // Drivers earn this share of each completed ride's fare.
  DRIVER_SHARE: 0.60,

  // ---------------- CHECKOUT / PROMO ----------------
  PROMO_CODES: ["MARIMACHI06"],

  // The FIRST account created on the site becomes the owner automatically.
  OWNER_EMAILS: []
};
