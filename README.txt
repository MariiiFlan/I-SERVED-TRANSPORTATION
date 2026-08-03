I SERVED TRANSPORTATION — WEBSITE
==================================

WHAT'S IN HERE
--------------
/                     Home page (hero + quick-start request widget)
/book/                Booking form with live fare estimate
/confirm/             Confirmation page after a request
/account/             Sign in / create account (one login for everyone)
/my-rides/            A signed-in client's own bookings + live status
/owner/               Dispatch console: dashboard, single booking, Team, reports
/driver/              Driver console: my rides, single ride with status buttons
/pay/                 Payment page — scaffolded, intentionally NOT live
/assets/config.js     <-- THE FILE YOU EDIT (phone, email, pricing)


PUT IT ONLINE (same as your other sites)
----------------------------------------
1. Unzip this into your GitHub repo folder.
2. Commit + push with GitHub Desktop.
3. GitHub Pages serves it. Done — no build step, no server.


ACCOUNTS & ROLES — READ THIS FIRST
-----------------------------------
* THE VERY FIRST ACCOUNT CREATED ON THE SITE BECOMES THE OWNER.
  So the first thing YOU do after the site is live: go to /account/ and
  create your account before sharing the link around.

* Everyone else who creates an account is a regular CLIENT. Clients see
  their own bookings under "My rides."

* From Owner console → Team, you type any EMAIL and give it Driver (worker)
  or Owner access:
    - If they already have an account, it switches instantly.
    - If they don't yet, the role is saved and applies automatically the
      moment they create an account with that email.
  You can also deactivate a driver, or "Remove access" to drop anyone back
  to a regular client account.

* Drivers sign in with the same /account/ page — once their email has the
  driver role, the Driver console just unlocks for them.

* Extra safety net: put your email in OWNER_EMAILS inside assets/config.js
  and that email is ALWAYS an owner when it registers.


PHONE / EMAIL / PRICING
-----------------------
All in assets/config.js:
  PHONE_DISPLAY / PHONE_TEL   -> currently (757) 806-8218
  EMAIL                       -> dispatch@iservedtransportation.com (placeholder,
                                 swap when the real one exists)
  Pricing                     -> currently the model from your approved design:
                                 base $24 one-way / $44 round trip, $2.90/mi,
                                 SUV +$9, wheelchair van +$18, add-ons for wait /
                                 door-through-door / before-6am-after-8pm.
                                 The comments in the file show the exact three
                                 lines to change if you want your original flat
                                 $2.50/mi sedan and $3.50/mi wheelchair instead.
Every page reads from this file, so one edit updates the whole site.


IMPORTANT: HOW THE DATA WORKS RIGHT NOW
----------------------------------------
This is a static site (GitHub Pages can't run a database), so accounts and
bookings are stored in the browser's own storage (localStorage). That means:

  ✓ Everything is fully functional — booking, accounts, roles, assigning,
    driver status taps, reports — and perfect for demoing and testing.
  ✗ Data lives per device/browser. A booking made on a client's phone will
    not appear on your laptop's dashboard, because there's no shared server.

To make it real across every device, the swap is Firebase (Google's free
database + login service):
  1. You create a free Firebase project at firebase.google.com (has to be
     you — it's tied to your Google account).
  2. Turn on "Authentication (Email/Password)" and "Firestore."
  3. Bring me the config keys it gives you, and I rewire assets/app.js to
     use it. None of the pages or designs change — same site, now synced.

Other hookups when you're ready (all have marked spots in the code):
  * SMS texts to drivers when assigned  -> Twilio account (owner/booking page)
  * Address autocomplete + real mileage -> Google Maps API key (book page)
  * Online payments                     -> Stripe or PayPal (/pay/ page, left
                                           blank on purpose, like AVR)


QUICK TEST SCRIPT (2 minutes)
-----------------------------
1. Open the site → /account/ → create YOUR account (becomes Owner).
2. Owner console → Team → type a second email you own → save as Driver.
3. Open a private/incognito window → create an account with that email →
   it lands straight in the Driver console.
4. Normal window: home page → book a ride → watch it appear on the owner
   dashboard → open it → tap the driver to assign.
5. Incognito window: the ride is sitting in the driver's list → Accept →
   On my way → Picked up → Completed.
6. Owner dashboard + Reports update as you go.
(Empty dashboard also has a "Load sample data" link if you want it to look
 busy for screenshots.)
