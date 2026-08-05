// ============================================================
//  I SERVED TRANSPORTATION — SETTINGS
//  The only file you edit for contact info + pricing.
// ============================================================
window.CONFIG = {
  COMPANY: "I Served Transportation",
  PHONE_DISPLAY: "(757) 806-8218",
  PHONE_TEL: "7578068218",
  EMAIL: "dispatch@iservedtransportation.com", // placeholder — swap when you have the real one

  // ---------------- FIREBASE (live database + logins) ----------------
  // These keys are safe to be public — security comes from the database
  // rules (firestore.rules — pasted into the Firebase console once).
  FIREBASE: {
    apiKey: "AIzaSyDNQDWoXBZOP78-Fjld34wb2uKnC8RyNew",
    authDomain: "iserved.firebaseapp.com",
    projectId: "iserved",
    storageBucket: "iserved.firebasestorage.app",
    messagingSenderId: "641810721894",
    appId: "1:641810721894:web:de0d925183f6093ccf51a7"
  },

  // ---------------- PRICING ----------------
  // This matches the fare model in your approved booking design:
  //   base fare + miles × per-mile + vehicle fee + add-ons.
  //
  // Want your original flat $2.50/$3.50 per mile instead? Set:
  //   BASE_ONEWAY: 0, BASE_ROUND: 0,
  //   PER_MILE: { sedan: 2.50, suv: 2.50, wav: 3.50 },
  //   VEHICLE_FEE: { sedan: 0, suv: 0, wav: 0 }
  BASE_ONEWAY: 24,
  BASE_ROUND: 44,
  PER_MILE: { sedan: 2.90, suv: 2.90, wav: 2.90 },
  VEHICLE_FEE: { sedan: 0, suv: 9, wav: 18 },
  ADDON_WAIT: 20,      // driver waits at appointment
  ADDON_ASSIST: 12,    // door-through-door assistance
  ADDON_AFTERHOURS: 25,// pickup before 6am / after 8pm

  // ---------------- CHECKOUT / PROMO ----------------
  // Online card payments aren't wired yet, so rides only reach the
  // dashboard through checkout with a valid promo code (testing) —
  // or by phone. Add/remove codes freely:
  PROMO_CODES: ["MARIMACHI06"],

  // The FIRST account created on the site becomes the owner automatically.
  // After that, grant owner/driver access from Owner console -> Team.
  OWNER_EMAILS: []
};
