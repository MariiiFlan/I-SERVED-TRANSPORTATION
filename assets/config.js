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
  // Matches the published rate card:
  //   Standard / Dialysis-Chemo:  $15.00 base, 10 free miles included
  //   Wheelchair transport:       $25.00 base, 10 free miles included
  //   Airport:                    quote by phone (base shown, call for specials)
  // Miles beyond the free 10 bill at the per-mile rate below.
  FREE_MILES: 10,
  BASE: { sedan: 15, suv: 15, wav: 25 },
  PER_MILE: { sedan: 2.50, suv: 2.50, wav: 3.50 },
  ROUND_TRIP_MULTIPLIER: 2,   // round trip = both legs billed

  // Wait time: first hour free, then per additional 30 min (max 1 extra hour)
  WAIT_FREE_MINUTES: 60,
  WAIT_PER_30MIN: 15,

  // Cancellation
  LATE_CANCEL_FEE: 20,

  // Add-ons (kept optional; set to 0 to hide from pricing)
  ADDON_ASSIST: 0,
  ADDON_AFTERHOURS: 0,

  // ---------------- SERVICE TYPES ----------------
  SERVICE_TYPES: [
    { id: "ambulatory", label: "Ambulatory transportation (sedan)", vehicle: "sedan" },
    { id: "wheelchair", label: "Wheelchair-accessible transportation", vehicle: "wav" },
    { id: "dialysis",   label: "Dialysis / chemo / recurring treatment", vehicle: "sedan" },
    { id: "airport",    label: "Airport transportation", vehicle: "sedan" },
    { id: "other",      label: "Other", vehicle: "sedan" }
  ],

  // ---------------- CHECKOUT / PROMO ----------------
  PROMO_CODES: ["MARIMACHI06"],

  // The FIRST account created on the site becomes the owner automatically.
  OWNER_EMAILS: []
};
