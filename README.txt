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
  EMAIL                      -> dispatch@iservedtransportation.com (placeholder)
  Pricing                    -> your approved design's model; comments in the
                                file show how to switch to flat $2.50/$3.50/mi.


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
