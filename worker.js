/* ============================================================
   I SERVED TRANSPORTATION - payment worker
   Runs on Cloudflare, NOT in the browser. This is the only place
   the Stripe secret key ever lives.

   SETUP (about 10 minutes, free):
   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker
   2. Name it: iserved-pay      -> Deploy
   3. Click "Edit code", delete what's there, paste THIS whole file, Deploy
   4. Go to Settings -> Variables and Secrets -> add these:
        STRIPE_SECRET   = the sk_live_... key from Stripe (mark as Secret)
        OWNER_EMAILS    = dflanagan@iservedtransport.com
                          (comma separated, lowercase, whoever may charge cards)
        ALLOWED_ORIGIN  = https://iservedtransportation.com,http://127.0.0.1:3000,http://localhost:3000
   5. Copy the worker URL (looks like https://iserved-pay.SOMETHING.workers.dev)
   6. Paste that URL into assets/config.js -> PAYMENT_API
   ============================================================ */

const STRIPE = "https://api.stripe.com/v1";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    // allow the live domain, any github.io preview, and local testing
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const okOrigin = allowed.length === 0 || allowed.includes(origin) || origin.endsWith(".github.io") || isLocal;
    const cors = {
      "Access-Control-Allow-Origin": okOrigin && origin ? origin : (allowed[0] || "*"),
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
    if (!env.STRIPE_SECRET) return json({ error: "Stripe secret not configured on the worker" }, 500, cors);

    const url = new URL(request.url);
    let body = {};
    try { body = await request.json(); } catch (e) {}

    try {
      if (url.pathname.endsWith("/setup-intent")) return await setupIntent(body, env, cors);
      if (url.pathname.endsWith("/charge")) return await charge(body, env, cors, request);
      if (url.pathname.endsWith("/ping"))         return json({ ok: true }, 200, cors);
      return json({ error: "Unknown endpoint" }, 404, cors);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500, cors);
    }
  }
};

/* ---------- helpers ---------- */
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, cors)
  });
}

async function stripe(env, path, params) {
  const res = await fetch(STRIPE + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.STRIPE_SECRET,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || "Stripe error");
  return data;
}

// Verifies a Firebase sign-in token and returns the person's email.
// (Firebase tokens are NOT Google OAuth tokens - they must be checked
// against Firebase's own endpoint.)
async function whoIsCalling(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Not signed in");
  const key = env.FIREBASE_API_KEY || "AIzaSyDNQDWoXBZOP78-Fjld34wb2uKnC8RyNew";
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token })
  });
  const data = await res.json();
  const user = data.users && data.users[0];
  if (!res.ok || !user) throw new Error("Sign-in expired - sign out and back in");
  return { email: String(user.email || "").toLowerCase(), token: token };
}

// Reads the ride straight from Firestore using the caller's own token, so
// the amount and card can never be faked by whoever is calling.
async function loadBooking(bookingId, token, env) {
  const project = env.FIREBASE_PROJECT_ID || "iserved";
  const url = "https://firestore.googleapis.com/v1/projects/" + project +
              "/databases/(default)/documents/bookings/" + encodeURIComponent(bookingId);
  const res = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
  if (!res.ok) throw new Error("Could not read that ride (permission denied)");
  const doc = await res.json();
  const f = doc.fields || {};
  const val = (x) => {
    if (!x) return null;
    if ("stringValue" in x) return x.stringValue;
    if ("doubleValue" in x) return Number(x.doubleValue);
    if ("integerValue" in x) return Number(x.integerValue);
    if ("booleanValue" in x) return x.booleanValue;
    if ("nullValue" in x) return null;
    return null;
  };
  return {
    id: bookingId,
    fare: Number(val(f.fare) || 0),
    status: val(f.status),
    name: val(f.name) || "",
    driverEmail: (val(f.driverEmail) || "").toLowerCase(),
    userEmail: (val(f.userEmail) || "").toLowerCase(),
    customerId: val(f.stripeCustomerId),
    paymentMethodId: val(f.stripePaymentMethodId),
    clientPaidOn: val(f.clientPaidOn)
  };
}

/* ---------- 1. customer saves a card at booking (no charge) ---------- */
async function setupIntent(body, env, cors) {
  const email = String(body.email || "").trim();
  const name  = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();

  const customer = await stripe(env, "/customers", {
    email: email || "",
    name: name || "",
    phone: phone || "",
    description: "I Served Transportation rider"
  });

  const intent = await stripe(env, "/setup_intents", {
    customer: customer.id,
    "payment_method_types[]": "card",
    usage: "off_session"
  });

  return json({ clientSecret: intent.client_secret, customerId: customer.id }, 200, cors);
}

/* ---------- 2. charge the saved card when the ride is completed ---------- */
async function charge(body, env, cors, request) {
  const caller = await whoIsCalling(request, env);
  const bookingId = String(body.bookingId || "").trim();
  if (!bookingId) throw new Error("No ride specified");

  const ride = await loadBooking(bookingId, caller.token, env);

  // The owner, or the driver actually assigned to this ride, may charge it.
  const owners = (env.OWNER_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const isOwner = owners.includes(caller.email);
  const isTheDriver = ride.driverEmail && ride.driverEmail === caller.email;
  if (!isOwner && !isTheDriver) throw new Error("Not permitted to charge this ride");

  if (ride.clientPaidOn) return json({ ok: true, alreadyPaid: true }, 200, cors);
  if (ride.status !== "Completed") throw new Error("Ride is not completed yet");
  if (!ride.customerId || !ride.paymentMethodId) throw new Error("no-card");

  // amount comes from the database, never from the browser
  const amountCents = Math.round(ride.fare * 100);
  if (!amountCents || amountCents < 50) throw new Error("Invalid fare on this ride");

  const intent = await stripe(env, "/payment_intents", {
    amount: String(amountCents),
    currency: "usd",
    customer: ride.customerId,
    payment_method: ride.paymentMethodId,
    off_session: "true",
    confirm: "true",
    description: "I Served Transportation - ride " + ride.id,
    "metadata[booking_id]": ride.id,
    "metadata[passenger]": ride.name,
    "metadata[charged_by]": caller.email
  });

  const card = intent.charges && intent.charges.data && intent.charges.data[0] &&
               intent.charges.data[0].payment_method_details &&
               intent.charges.data[0].payment_method_details.card;

  return json({
    ok: intent.status === "succeeded",
    status: intent.status,
    amount: ride.fare,
    paymentIntentId: intent.id,
    last4: (card && card.last4) || ""
  }, 200, cors);
}
