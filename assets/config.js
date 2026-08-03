// ============================================================
//  I SERVED TRANSPORTATION — SETTINGS
//  The only file you edit for contact info + pricing.
// ============================================================
window.CONFIG = {
  COMPANY: "I Served Transportation",
  PHONE_DISPLAY: "(757) 806-8218",
  PHONE_TEL: "7578068218",
  EMAIL: "dispatch@iservedtransportation.com", // placeholder — swap when you have the real one

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

  // Emails in this list are ALWAYS owners the moment they create an account.
  // (The very first account created on the site also becomes an owner automatically.)
  OWNER_EMAILS: []
};
