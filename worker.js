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
      if (url.pathname.endsWith("/charge")) {
        await requireOwner(request, env);
        return await charge(body, env, cors);
      }
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

// Only a signed-in owner may charge a saved card. Verifies the Firebase
// token with Google and checks the email against OWNER_EMAILS.
async function requireOwner(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing sign-in token");
  const res = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token));
  if (!res.ok) throw new Error("Sign-in token rejected");
  const info = await res.json();
  const email = String(info.email || "").toLowerCase();
  const owners = (env.OWNER_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  if (!email || (owners.length && !owners.includes(email))) throw new Error("Not permitted to charge cards");
  return email;
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
async function charge(body, env, cors) {
  const amountCents = Math.round(Number(body.amount) * 100);
  if (!amountCents || amountCents < 50) throw new Error("Invalid amount");
  if (!body.customerId || !body.paymentMethodId) throw new Error("No saved card for this ride");

  const intent = await stripe(env, "/payment_intents", {
    amount: String(amountCents),
    currency: "usd",
    customer: body.customerId,
    payment_method: body.paymentMethodId,
    off_session: "true",
    confirm: "true",
    description: "I Served Transportation - ride " + (body.bookingId || ""),
    "metadata[booking_id]": body.bookingId || "",
    "metadata[passenger]": body.passenger || ""
  });

  return json({
    ok: intent.status === "succeeded",
    status: intent.status,
    paymentIntentId: intent.id,
    last4: (intent.charges && intent.charges.data && intent.charges.data[0] &&
            intent.charges.data[0].payment_method_details &&
            intent.charges.data[0].payment_method_details.card &&
            intent.charges.data[0].payment_method_details.card.last4) || ""
  }, 200, cors);
}
