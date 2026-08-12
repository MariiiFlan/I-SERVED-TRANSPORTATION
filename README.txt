I SERVED TRANSPORTATION - WEBSITE (Firebase edition)
=====================================================

WHAT'S IN HERE
--------------
/                     Home page (hero + quick-start request widget)
/book/                Booking form with live fare estimate
/confirm/             Confirmation page after a request
/account/             Sign in / create account (one login for everyone)
/my-rides/            A signed-in client's own bookings + live status
/owner/               Dispatch console: dashboard, booking, Team, reports, IMPORT
/driver/              Driver console: my rides, single ride with status buttons
/pay/                 Payment page - scaffolded, intentionally NOT live
/assets/config.js     Contact info + pricing + Firebase keys
/firestore.rules      Database security rules  <-- MUST BE PASTED IN (below)
/data/saferide_rides.csv  Your Saferide export, ready to import


STEP 1 - PUT IT ONLINE (same as your other sites)
--------------------------------------------------
1. Unzip this into your GitHub repo folder (replace the old files).
2. Commit + push with GitHub Desktop.


STEP 2 - PASTE THE DATABASE RULES  (one time, 2 minutes, REQUIRED)
-------------------------------------------------------------------
The database was created in "production mode," which blocks everything
until rules are installed. Until you do this, the site will show a
yellow banner and accounts won't save.

1. Go to console.firebase.google.com -> your "iserved" project
2. Left sidebar -> Firestore Database -> "Rules" tab
3. Delete everything in the box
4. Open the firestore.rules file from this zip in Notepad,
   copy ALL of it, paste it into the box
5. Click "Publish"

That's it. These rules make sure: nobody can promote themselves,
only owners see all data, drivers only see their assigned rides,
and clients only see their own bookings.


STEP 3 - CREATE THE OWNER ACCOUNT (before sharing the link!)
-------------------------------------------------------------
THE VERY FIRST ACCOUNT CREATED ON THE SITE BECOMES THE OWNER.
Go to yoursite/account/ and create your dad's account first.
(Passwords need 6+ characters - that's a Firebase requirement.)

After that:
* Everyone else who signs up is a regular CLIENT (sees "My rides").
* Owner console -> Team: type any EMAIL, save as Driver or Owner.
  - Already has an account? Access changes instantly.
  - No account yet? The role is waiting the moment they sign up
    with that email.
* "Remove access" drops anyone back to a regular client.

EVERYTHING NOW SYNCS FOR REAL: a client books on their phone, it
appears on dad's dashboard within seconds. Drivers see assignments
live. This is the real system, not a demo anymore.


IMPORTING RIDES FROM SPREADSHEETS (Saferide etc.)
--------------------------------------------------
Owner console -> Dashboard -> "Import rides" button.
* Takes .csv or Excel .xlsx files.
* Reads the column headers and auto-maps: ride ID, status, passenger,
  phone, pickup, drop-off, date, time, miles, fare, vehicle, notes.
* Reads full MediRoutes / Saferide exports: TripID, pickup and drop-off
  street/city/state/zip (joined into one address), pickup + drop-off
  times, passenger name and phone, pickup and drop-off notes, member ID,
  age, escorts, attendants, car seats, mobility type, miles, and payor.
* TripType A = ride to the appointment, B = the return leg. Each leg
  imports as its own trip, labeled in the notes.
* MobilityType maps to the service type (AMB -> ambulatory sedan,
  WC/wheelchair -> wheelchair van).
* Fares are auto-calculated from the rate card when the file has none.
* Statuses map like this:
    Scheduled  -> New
    WillCall   -> New, tagged "Will-call return" in the notes
    Cancelled  -> Cancelled
    Completed  -> Completed   (and In Progress -> En route, etc.)
* "Wheelchair" anywhere in the vehicle column -> wheelchair van.
* Rides are keyed by their ride ID (SR-xxxxxxx), so importing the
  same file twice NEVER duplicates. If a ride's status changed in a
  newer export, the import updates it and logs the change.
* Your current Saferide export is included at data/saferide_rides.csv
  - import it as your first test. It contains 22 rides: 20 active
  (8 of them will-call returns), 2 cancelled, 10 wheelchair.

Note: this particular Saferide export has no passenger names,
addresses, or dates (Saferide keeps those in their portal), so those
rides show "TBD" until you open one and it's filled from the portal.
If you can export a fuller report from Saferide (with names/addresses),
the importer will pick all of it up automatically.


CHECKOUT + PROMO CODE (how bookings reach the dashboard now)
--------------------------------------------------------------
The public booking form no longer sends rides straight to the
dashboard. Flow is now: Book -> Checkout -> dispatch.
* Card payment on the checkout page is scaffolded but OFF until
  Stripe/PayPal is wired - the page says to call instead.
* Promo code MARIMACHI06 unlocks checkout with no charge (for
  testing). Add/remove codes in assets/config.js -> PROMO_CODES.
* EXCEPTION: when the OWNER is signed in and books (e.g. "New
  booking" on the dashboard for phone-in clients), it skips
  checkout and saves directly.

RIDE APPROVAL (every request goes through your dad first)
----------------------------------------------------------
A ride booked on the website arrives as PENDING. It is invisible to
drivers until it is approved.
  * Dashboard -> "Pending approval (n)" filter, or the orange attention
    banner at the top
  * Approve / Decline buttons sit right on the row, and also at the top
    of the ride's own page
  * Declining cancels it and logs the reason
  * Rides HE books himself (signed in as owner) skip approval - they are
    already his

CARD PAYMENTS - TURNING THEM ON (about 10 minutes, one time)
=============================================================
The site is fully built for cards. It goes live the moment the worker
is deployed. Follow worker.js - the steps are at the top of that file:

  1. Cloudflare -> Workers & Pages -> Create Worker -> name it iserved-pay
  2. Edit code -> paste all of worker.js -> Deploy
  3. Settings -> Variables and Secrets, add:
       STRIPE_SECRET   = the sk_live_... key   (mark as Secret)
       OWNER_EMAILS    = dflanagan@iservedtransport.com
       ALLOWED_ORIGIN  = https://iservedtransportation.com
  4. Copy the worker URL and paste it into assets/config.js -> PAYMENT_API
  5. Push. Done - the card form appears at checkout automatically.

WHY THE WORKER: Stripe's secret key can charge cards and issue refunds.
Anything in the website folder is readable by anyone who views the page
source, so the key cannot live there. The worker runs on Cloudflare's
servers where nobody can read it. The publishable key in config.js IS
safe to be public - that is what it is designed for.

IF THE SECRET KEY EVER LEAKS: Stripe -> Developers -> API keys -> roll it.
Takes 20 seconds and instantly kills the old one.

HOW CARDS WORK ONCE LIVE
-------------------------
  * At checkout the client enters their card. NOTHING is charged. The card
    is stored with Stripe (never on this site) and attached to the ride.
  * The moment a driver marks that ride Completed, the card is charged the
    final fare automatically and the ride flips to Paid.
  * If the charge fails, the client is emailed the bill instead and the
    ride shows "last charge failed" with a Charge the card button to retry.
  * Rides booked with a promo code (or by phone) have no card - those still
    get the emailed bill.

CLIENT PAYMENTS (billed the moment the ride is completed)
----------------------------------------------------------
Nothing is charged when someone books. The SECOND a driver marks a ride
Completed, the bill goes out automatically:
  * The client is emailed the amount due, the trip details, and the
    number to call (only if they booked with an account - otherwise use
    the Send bill / Text the bill buttons)
  * A copy lands in the office inbox so you know it went out
  * The ride flips to PAYMENT DUE

On the dashboard row and the ride page you also get:
  * "Send bill" / "Resend bill" - email it again
  * "Text the bill" - opens your messages with the whole thing written
  * "Collect $X" - log how they actually paid
  * Dashboard -> "Payment due (n)" filter shows every uncollected ride
  * "Collect $X" on the row (or "Record payment received" on the ride
    page) logs how they paid: cash, card, Zelle, invoiced, broker
  * The client sees "Payment due" on their My Rides page with the amount
  * To take cards online later, add Stripe or PayPal - the /pay/ page is
    scaffolded for it and nothing else has to change

DRIVER PAY (owner console -> Driver pay)  ** OWNER ONLY **
-----------------------------------------------------------
Every driver's earnings, calculated automatically at 60% of the fare on
each COMPLETED ride. Change the split in assets/config.js -> DRIVER_SHARE.

Three stages, so nothing is ever marked paid before the money moves:
  1. NOT INVOICED - completed rides with no invoice yet
  2. AWAITING PAYMENT - invoice created and sent, money not out yet
  3. PAID - confirmed by you

  * "Create invoice - $X" lists every uninvoiced ride with its 60% cut.
    Untick any you are skipping. It builds a REAL invoice page: company
    header, driver details, every ride line, and the total.
      - Print / Save as PDF
      - Email to driver (opens your mail app, filled in)
      - Text the driver
      - Copy details (paste into Invoice Simple or anything else)
    Creating the invoice does NOT mark anything paid.
  * "Payment history" is where everything lives:
      - "Open / resend invoice" pulls the same invoice back up any time
      - "Mark as paid" - one tap, with a confirm, once the money is out
      - "Undo paid" if you tap it by mistake
  * "Record as already paid" is the shortcut for when he handed over cash
    and just needs it logged (it asks for confirmation first).
  * "Text pay summary" texts the driver what they are owed.

DRIVER INVOICES (built in - no other app needed)
-------------------------------------------------
"Create invoice" on the Driver pay page builds an I Served invoice:
company header and logo, the driver's details, every ride listed with
its fare and 60% cut, and the total. From there:
  * Print / Save as PDF
  * Email to driver (opens your mail app with it written out)
  * Text the driver
  * Copy details
It stays in Payment history forever - "Open / resend invoice" pulls the
same one back up any time, and "Mark as paid" logs it once the money
has gone out.

ASSIGNING RIDES (single or in bulk)
------------------------------------
* Tick the checkboxes on the dashboard (or the header box to select the
  whole filtered list), pick a driver in the blue bar, hit "Assign
  selected". One driver, many rides, one click.
* After a bulk assign it offers to text that driver the whole batch -
  every ride written out, you just press send.
* The bar also bulk-trashes selected rides.

ACCEPT / DECLINE (works both ways)
-----------------------------------
Assign -> the ride shows "awaiting accept" until the driver taps Accept.
  * Driver ACCEPTS  -> status Accepted, you get an email.
  * Driver DECLINES -> the ride drops back into the unassigned pool
    automatically, you get an email with their reason, and the ride is
    tagged so you never lose that history.
Where you see it:
  * Dashboard filters: "Awaiting accept (n)" and "Declined (n)"
  * An orange "Needs your attention" banner at the top when rides come
    back declined, or sit unaccepted more than 2 hours
  * Red "n DECLINED" tag on the ride row, plus who declined and why
  * Open the ride: full decline history, and any driver who already said
    no is marked "already declined this ride" in the assign list (you can
    still reassign them - it just warns you first)
  * Schedules page: per-driver decline counts for that day

DRIVER SCHEDULES (owner console -> Schedules)
----------------------------------------------
Day-by-day view of every driver: what they're carrying, total miles and
money, and crucially whether they ACCEPTED or DECLINED each ride.
  * "Waiting on driver" = assigned but not accepted yet
  * Declined rides drop into a "Needs rescheduling" box at the top with
    the driver's reason, so you can reassign immediately
  * Arrows step through days; "Text schedule" sends a driver their day

TRASH + EDITING (owner dashboard)
----------------------------------
* Every row has a trash can - moves the ride to Trash (hidden from
  all consoles, including drivers and clients).
* The "Trash (n)" chip shows what's in there, with Restore per ride
  and "Clear trash permanently" (no undo).
* "Trash all shown" bulk-trashes everything matching the current filter
  and search (e.g. filter to Cancelled, then trash them all at once).
* Open any booking -> "Edit trip" lets you change EVERYTHING: name,
  phone, addresses, date/time, trip type, vehicle, miles, add-ons,
  notes, and the fare ("Recalculate from details" refigures it).

MAP + MEASURED MILES (booking page)
------------------------------------
Start typing an address and pick from the suggestions - a map
appears with pins, and when both ends are chosen the actual driving
route is measured and the mileage fills itself in (with an "adjust
manually" fallback). Free OpenStreetMap services, no API keys or
billing. If you ever want Google's data instead, that swap is easy
later.

ALERTS: EMAIL + TEXTING DRIVERS
--------------------------------
EMAILS (automatic, free, no keys):
  * Every new ride booked -> email to NOTIFY_EMAIL in assets/config.js
  * Driver accepts a ride -> email
  * Driver declines a ride -> email with the reason
  ONE-TIME ACTIVATION: the very first alert arrives as a "confirm this
  address" email from FormSubmit. Click the link inside once, and every
  alert after that lands normally. (Check spam the first time.)

TEXTING DRIVERS (one tap, you hit send):
  * Open a booking -> assign a driver -> "Text ride details" opens your
    phone's messages with the passenger, time, both addresses, service
    type, and notes already written out. Just press send.
  * Schedules page -> "Text schedule" sends a driver their whole day.
  * "Call driver" dials them.
  Requires a mobile number saved for that driver on the Team page.

(True automatic SMS - texts that send themselves with no tap - needs a
paid Twilio account plus US business registration. The tap-to-send
buttons above do the same job for free.)

CUSTOM DOMAIN LATER?
--------------------
One extra step when you get it: Firebase console -> Authentication ->
Settings -> Authorized domains -> Add domain -> type your new domain.
30 seconds, nothing else changes.


PHONE / EMAIL / PRICING
-----------------------
All in assets/config.js:
  PHONE_DISPLAY / PHONE_TEL  -> (757) 806-8218
  NOTIFY_EMAIL               -> where booking alerts go

PRICING (three service tiers, fare = base + miles x rate):
    Ambulatory (sedan)     no base fare,  $1.50 per mile
    Wheelchair van         $25.00 base,   $2.50 per mile
    Stretcher / gurney     $125.00 base,  $3.50 per mile
  Round trips bill both legs: base x2, and all miles counted.
  Change any of it in the BASE and PER_MILE lines of config.js.

  NOTE: FREE_MILES is now 0. It used to include the first 10 miles free,
  but with ambulatory having no base fare that made short trips cost
  $0.00. If you ever want free miles back, only do it for the tiers that
  have a base fare.

STILL TO HOOK UP WHEN READY (all have marked spots)
----------------------------------------------------
  * SMS texts to drivers when assigned  -> Twilio (~$1/mo + ~1c/text)
  * Address autocomplete + real mileage -> Google Maps API key (free tier)
  * Online payments                     -> Stripe or PayPal (/pay/ is
                                           scaffolded blank on purpose)


QUICK TEST (do this after steps 1-3)
-------------------------------------
1. /account/ -> create dad's account (first = Owner).
2. Team -> add a second email you own as Driver.
3. On your PHONE (not incognito needed - it's a real database now):
   create the driver account with that email -> Driver console unlocks.
4. On any device: book a ride -> watch it pop onto dad's dashboard.
5. Assign it -> it appears on the phone -> Accept -> On my way ->
   Picked up -> Completed -> dashboard updates live.
6. Dashboard -> Import rides -> pick data/saferide_rides.csv -> import.
