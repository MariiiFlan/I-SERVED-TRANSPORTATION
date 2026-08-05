/* ============================================================
   I SERVED TRANSPORTATION — core (Firebase edition)
   Accounts = Firebase Authentication (email/password).
   Data     = Cloud Firestore, live-synced across every device.
   Pages read from an in-memory cache that Firestore keeps fresh
   in real time; writes go straight to Firestore (with an
   optimistic local update so buttons feel instant).
   ============================================================ */
(function () {
  var C = window.CONFIG;

  firebase.initializeApp(C.FIREBASE);
  var fbAuth = firebase.auth();
  var db = firebase.firestore();
  var FV = firebase.firestore.FieldValue;

  /* ---------------- live cache ---------------- */
  var ME = null;              // {uid, email, name, phone, role}
  var BOOKINGS = [];          // visible bookings for this account's role
  var USERS = [];             // all user docs (owners only)
  var GRANTS = {};            // email -> {role, vehicle, cred, phone, active} (owners + own)
  var BOOTSTRAPPED = false;   // does the site have its first owner yet
  var DBERROR = null;
  var unsubs = [];
  var changeHandlers = [];

  function norm(email) { return String(email || "").trim().toLowerCase(); }
  function fireChange() { changeHandlers.forEach(function (f) { try { f(); } catch (e) {} }); }
  function friendly(e) {
    var code = (e && e.code) || "";
    if (code.indexOf("permission-denied") > -1) return "The database security rules aren't installed yet — open README.txt and do the 'PASTE THE DATABASE RULES' step (2 minutes).";
    if (code.indexOf("email-already-in-use") > -1) return "An account with that email already exists — sign in instead.";
    if (code.indexOf("invalid-credential") > -1 || code.indexOf("wrong-password") > -1 || code.indexOf("user-not-found") > -1) return "Email or password doesn't match an account.";
    if (code.indexOf("weak-password") > -1) return "Password needs at least 6 characters.";
    if (code.indexOf("invalid-email") > -1) return "That email doesn't look right.";
    if (code.indexOf("network") > -1) return "Network problem — check the connection and try again.";
    return (e && e.message) || String(e);
  }

  function clearSubs() { unsubs.forEach(function (u) { try { u(); } catch (e) {} }); unsubs = []; }

  function subscribe() {
    clearSubs();
    BOOKINGS = []; USERS = []; GRANTS = {};
    if (!ME) { fireChange(); return Promise.resolve(); }
    var firsts = [];
    function sub(q, apply) {
      var resolveFirst; var p = new Promise(function (res) { resolveFirst = res; });
      firsts.push(p);
      unsubs.push(q.onSnapshot(function (snap) {
        apply(snap); resolveFirst(); fireChange();
      }, function (err) { DBERROR = friendly(err); resolveFirst(); fireChange(); }));
    }
    function applyBookings(snap) {
      BOOKINGS = snap.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
    }
    if (ME.role === "owner") {
      sub(db.collection("bookings"), applyBookings);
      sub(db.collection("users"), function (snap) {
        USERS = snap.docs.map(function (d) { var x = d.data(); x.uid = d.id; return x; });
      });
      sub(db.collection("grants"), function (snap) {
        GRANTS = {}; snap.docs.forEach(function (d) { GRANTS[d.id] = d.data(); });
      });
    } else if (ME.role === "driver") {
      sub(db.collection("bookings").where("driverEmail", "==", ME.email), applyBookings);
      // a driver may also have booked personal rides
      sub(db.collection("bookings").where("userEmail", "==", ME.email), function (snap) {
        var own = snap.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
        var ids = {}; BOOKINGS.forEach(function (b) { ids[b.id] = 1; });
        own.forEach(function (b) { if (!ids[b.id]) BOOKINGS.push(b); });
      });
    } else {
      sub(db.collection("bookings").where("userEmail", "==", ME.email), applyBookings);
    }
    return Promise.all(firsts);
  }

  function loadMe(fbUser) {
    if (!fbUser) { ME = null; return Promise.resolve(null); }
    return db.collection("users").doc(fbUser.uid).get().then(function (doc) {
      if (doc.exists) {
        var d = doc.data();
        ME = { uid: fbUser.uid, email: norm(d.email || fbUser.email), name: d.name || "", phone: d.phone || "", role: d.role || "client" };
        // pending grant elevation (owner promoted this email after signup)
        return db.collection("grants").doc(ME.email).get().then(function (g) {
          if (g.exists && g.data().role && g.data().role !== ME.role) {
            var newRole = g.data().role;
            return db.collection("users").doc(ME.uid).update({ role: newRole }).then(function () {
              ME.role = newRole; return ME;
            }).catch(function () { return ME; });
          }
          return ME;
        }).catch(function () { return ME; });
      }
      ME = null; return null;
    }).catch(function (e) { DBERROR = friendly(e); ME = null; return null; });
  }

  var readyPromise = null;
  function ready(cb) {
    if (!readyPromise) {
      readyPromise = new Promise(function (resolve) {
        db.collection("meta").doc("bootstrap").get()
          .then(function (d) { BOOTSTRAPPED = d.exists; })
          .catch(function (e) { DBERROR = DBERROR || friendly(e); })
          .then(function () {
            var un = fbAuth.onAuthStateChanged(function (fbUser) {
              un();
              loadMe(fbUser).then(subscribe).then(resolve);
            });
          });
      });
    }
    readyPromise.then(function () { cb(); });
  }

  /* ---------------- auth ---------------- */
  var AUTH = {
    me: function () { return ME; },
    register: async function (name, email, phone, password) {
      email = norm(email);
      if (!name || !email || !password) throw "Fill in name, email, and password.";
      if (password.length < 6) throw "Password needs at least 6 characters.";
      try {
        var cred = await fbAuth.createUserWithEmailAndPassword(email, password);
        var role = "client";
        try {
          var g = await db.collection("grants").doc(email).get();
          if (g.exists && g.data().role) role = g.data().role;
        } catch (e) {}
        var boot = false;
        if (role === "client") {
          try {
            var b = await db.collection("meta").doc("bootstrap").get();
            if (!b.exists) { role = "owner"; boot = true; }
          } catch (e) {}
          if (!BOOTSTRAPPED && (C.OWNER_EMAILS || []).map(norm).indexOf(email) > -1) { role = "owner"; boot = true; }
        }
        var batch = db.batch();
        batch.set(db.collection("users").doc(cred.user.uid), {
          name: name.trim(), email: email, phone: (phone || "").trim(), role: role, created: FV.serverTimestamp()
        });
        if (boot) batch.set(db.collection("meta").doc("bootstrap"), { uid: cred.user.uid, t: FV.serverTimestamp() });
        await batch.commit();
        BOOTSTRAPPED = true;
        await loadMe(cred.user); await subscribe();
        return role;
      } catch (e) { throw friendly(e); }
    },
    signIn: async function (email, password) {
      try {
        var cred = await fbAuth.signInWithEmailAndPassword(norm(email), password);
        var me = await loadMe(cred.user);
        if (!me) throw { code: "permission-denied" };
        await subscribe();
        return me;
      } catch (e) { throw friendly(e); }
    },
    signOutTo: function (url) {
      fbAuth.signOut().then(function () { location.href = url; }, function () { location.href = url; });
    },
    setRole: function (email, role, profilePatch) {
      email = norm(email);
      var data = Object.assign({ role: role }, profilePatch || {});
      GRANTS[email] = Object.assign({}, GRANTS[email] || {}, data); // optimistic
      var jobs = [db.collection("grants").doc(email).set(data, { merge: true })];
      var u = USERS.find(function (x) { return norm(x.email) === email; });
      if (u) { u.role = role; jobs.push(db.collection("users").doc(u.uid).update({ role: role })); }
      fireChange();
      return Promise.all(jobs).catch(function (e) { alert(friendly(e)); });
    },
    removeRole: function (email) {
      email = norm(email);
      delete GRANTS[email];
      var jobs = [db.collection("grants").doc(email).delete()];
      var u = USERS.find(function (x) { return norm(x.email) === email; });
      if (u) { u.role = "client"; jobs.push(db.collection("users").doc(u.uid).update({ role: "client" })); }
      fireChange();
      return Promise.all(jobs).catch(function (e) { alert(friendly(e)); });
    },
    saveProfile: function (email, patch) {
      email = norm(email);
      GRANTS[email] = Object.assign({}, GRANTS[email] || {}, patch);
      fireChange();
      return db.collection("grants").doc(email).set(patch, { merge: true }).catch(function (e) { alert(friendly(e)); });
    },
    accounts: function () {
      var list = USERS.map(function (u) { return { name: u.name, email: norm(u.email), phone: u.phone, role: u.role || "client", uid: u.uid }; });
      Object.keys(GRANTS).forEach(function (email) {
        if (!list.find(function (u) { return u.email === email; }))
          list.push({ name: "(invited — hasn't created account yet)", email: email, role: GRANTS[email].role || "driver", pending: true });
      });
      return list;
    },
    profile: function (email) { return GRANTS[norm(email)] || {}; },
    drivers: function () {
      return AUTH.accounts().filter(function (u) { return u.role === "driver" || u.role === "owner"; })
        .map(function (u) { var pr = AUTH.profile(u.email); return Object.assign({}, u, pr, { active: pr.active !== false }); });
    },
    require: function (role, next) {
      if (!ME) { location.href = ISV.root + "account/?next=" + encodeURIComponent(next || location.pathname); return null; }
      if (role === "owner" && ME.role !== "owner") { location.href = ISV.root + "account/?denied=owner"; return null; }
      if (role === "driver" && ME.role !== "driver" && ME.role !== "owner") { location.href = ISV.root + "account/?denied=driver"; return null; }
      return ME;
    }
  };

  /* ---------------- bookings ---------------- */
  function newId() { return "IST-" + Math.floor(100000 + Math.random() * 899999); }
  var BOOK = {
    all: function () { return BOOKINGS.slice(); },
    byId: function (id) {
      var b = BOOKINGS.find(function (x) { return x.id === id; });
      if (b) return b;
      try { var last = JSON.parse(sessionStorage.getItem("isv_last_booking") || "null"); if (last && last.id === id) return last; } catch (e) {}
      return null;
    },
    add: function (b) {
      b.id = newId();
      b.created = Date.now();
      b.status = b.status || "New";
      b.driverEmail = b.driverEmail || null;
      b.userEmail = b.userEmail ? norm(b.userEmail) : null;
      b.log = b.log || [{ t: Date.now(), text: "Requested online — form submitted with estimate " + ISV.money(b.fare || 0) }];
      BOOKINGS.push(b); // optimistic
      try { sessionStorage.setItem("isv_last_booking", JSON.stringify(b)); } catch (e) {}
      db.collection("bookings").doc(b.id).set(b).catch(function (e) { alert("Couldn't save the booking: " + friendly(e)); });
      fireChange();
      return b;
    },
    update: function (id, patch, logText) {
      var b = BOOKINGS.find(function (x) { return x.id === id; });
      if (b) { Object.assign(b, patch); if (logText) { b.log = (b.log || []).concat([{ t: Date.now(), text: logText }]); } }
      var data = Object.assign({}, patch);
      if (logText) data.log = FV.arrayUnion({ t: Date.now(), text: logText });
      db.collection("bookings").doc(id).update(data).catch(function (e) { alert("Couldn't save that change: " + friendly(e)); });
      fireChange();
    },
    importSet: function (docs) { // bulk import/upsert, chunked batches
      var chunks = [];
      for (var i = 0; i < docs.length; i += 400) chunks.push(docs.slice(i, i + 400));
      var chain = Promise.resolve();
      chunks.forEach(function (chunk) {
        chain = chain.then(function () {
          var batch = db.batch();
          chunk.forEach(function (d) { batch.set(db.collection("bookings").doc(d.id), d, { merge: true }); });
          return batch.commit();
        });
      });
      return chain;
    },
    mine: function (me) {
      if (!me) return [];
      return BOOK.all().filter(function (b) { return b.userEmail === me.email; });
    },
    forDriver: function (email) {
      email = norm(email);
      return BOOK.all().filter(function (b) { return b.driverEmail === email && b.status !== "Cancelled"; });
    }
  };

  /* ---------------- fare ---------------- */
  function money(n) { return "$" + Number(n || 0).toFixed(2); }
  function fare(s) {
    var round = s.tripType === "round";
    var miles = Number(s.miles || 0) * (round ? 2 : 1);
    var base = round ? C.BASE_ROUND : C.BASE_ONEWAY;
    var perMile = (C.PER_MILE[s.vehicle] != null ? C.PER_MILE[s.vehicle] : C.PER_MILE.sedan);
    var mileage = miles * perMile;
    var vehicleFee = C.VEHICLE_FEE[s.vehicle] || 0;
    var a = s.addOns || {};
    var wait = a.wait ? C.ADDON_WAIT : 0, assist = a.assist ? C.ADDON_ASSIST : 0, after = a.afterHours ? C.ADDON_AFTERHOURS : 0;
    var rows = [];
    if (base) rows.push({ label: round ? "Round-trip base fare" : "Base fare", amount: money(base) });
    rows.push({ label: miles + " mi × " + money(perMile), amount: money(mileage) });
    if (vehicleFee) rows.push({ label: s.vehicle === "wav" ? "Wheelchair van" : "SUV", amount: money(vehicleFee) });
    if (wait) rows.push({ label: "Driver waits at appointment", amount: money(wait) });
    if (assist) rows.push({ label: "Door-through-door assist", amount: money(assist) });
    if (after) rows.push({ label: "Before 6am / after 8pm", amount: money(after) });
    return { total: base + mileage + vehicleFee + wait + assist + after, rows: rows, miles: miles };
  }
  function vehicleName(v) { return v === "wav" ? "Wheelchair-accessible van" : v === "suv" ? "SUV" : "Sedan"; }
  function vehicleShort(v) { return v === "wav" ? "Wheelchair van" : v === "suv" ? "SUV" : "Sedan"; }

  /* ---------------- shared UI (design language) ---------------- */
  function logo(sz, dark, sub) {
    var w = sz || 38, h = Math.round(w * 10 / 38);
    var c1 = dark ? "#fff" : "oklch(0.76 0.09 237)", c2 = dark ? "oklch(0.80 0.08 237)" : "oklch(0.62 0.115 237)", c3 = dark ? "oklch(0.62 0.10 237)" : "oklch(0.38 0.05 245)";
    function bar(c) { return '<div style="width:' + w + 'px;height:' + h + 'px;background:' + c + ';clip-path:polygon(0 0,50% 100%,100% 0,100% 34%,50% 100%,0 34%);"></div>'; }
    return '<div style="display:flex;align-items:center;gap:11px;">' +
      '<div style="display:flex;flex-direction:column;gap:' + Math.max(2, Math.round(w / 13)) + 'px;align-items:center;">' + bar(c1) + bar(c2) + bar(c3) + '</div>' +
      '<div style="display:flex;flex-direction:column;">' +
      '<span style="font:700 ' + Math.round(w * 25 / 38) + 'px/0.95 \'Barlow Condensed\',sans-serif;letter-spacing:0.015em;text-transform:uppercase;color:' + (dark ? "#fff" : "inherit") + ';">I Served</span>' +
      '<span style="font:500 ' + Math.max(8, Math.round(w * 9 / 38)) + 'px/1 Barlow,sans-serif;letter-spacing:0.26em;text-transform:uppercase;color:' + (dark ? "oklch(0.78 0.07 237)" : "oklch(0.62 0.11 237)") + ';">' + (sub || "Transportation") + '</span>' +
      '</div></div>';
  }

  function dbBanner() {
    return DBERROR ? '<div style="background:oklch(0.96 0.03 85);padding:12px 32px;font:500 14px/1.5 Figtree,sans-serif;color:oklch(0.42 0.09 75);text-align:center;">' + DBERROR + '</div>' : '';
  }

  function header(root) {
    var acct;
    if (!ME) acct = '<a href="' + root + 'account/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Sign in</a>';
    else {
      var links = '<a href="' + root + 'my-rides/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">My rides</a>';
      if (ME.role === "driver") links += '<a href="' + root + 'driver/rides/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Driver console</a>';
      if (ME.role === "owner") links += '<a href="' + root + 'owner/dashboard/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Dispatch console</a>';
      acct = links;
    }
    return dbBanner() + '<header style="position:sticky;top:0;z-index:20;background:rgba(255,255,255,0.92);backdrop-filter:blur(10px);border-bottom:1px solid oklch(0.93 0.01 250);">' +
      '<div style="max-width:1180px;margin:0 auto;padding:0 32px;height:76px;display:flex;align-items:center;justify-content:space-between;gap:24px;">' +
      '<a href="' + root + '" style="color:inherit;">' + logo(38) + '</a>' +
      '<nav style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;">' + acct +
      '<span style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.34 0.02 250);">' + C.PHONE_DISPLAY + '</span>' +
      '<a href="' + root + 'book/" style="padding:12px 20px;border-radius:8px;background:oklch(0.62 0.115 237);color:#fff;font:600 15px/1 Figtree,sans-serif;">Book now</a>' +
      '</nav></div></header>';
  }

  function footer(root) {
    return '<footer style="border-top:1px solid oklch(0.93 0.01 250);background:#fff;">' +
      '<div style="max-width:1180px;margin:0 auto;padding:48px 32px;display:flex;align-items:flex-start;justify-content:space-between;gap:40px;flex-wrap:wrap;">' +
      '<div style="display:flex;flex-direction:column;gap:12px;max-width:320px;">' +
      '<div style="display:flex;align-items:center;gap:11px;">' + logo(28) + '</div>' +
      '<span style="font:400 14px/1.6 Figtree,sans-serif;color:oklch(0.55 0.015 250);">Veteran-owned non-emergency medical transportation. Wildomar, CA 92595 · serving Riverside County.</span></div>' +
      '<div style="display:flex;gap:56px;flex-wrap:wrap;">' +
      '<div style="display:flex;flex-direction:column;gap:10px;"><span style="font:600 11px/1 Barlow,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:oklch(0.62 0.11 237);">Contact</span>' +
      '<a href="tel:' + C.PHONE_TEL + '" style="font:500 15px/1 Figtree,sans-serif;">' + C.PHONE_DISPLAY + '</a>' +
      '<a href="mailto:' + C.EMAIL + '" style="font:500 15px/1 Figtree,sans-serif;">' + C.EMAIL + '</a></div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;"><span style="font:600 11px/1 Barlow,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:oklch(0.62 0.11 237);">Hours</span>' +
      '<span style="font:500 15px/1 Figtree,sans-serif;color:oklch(0.40 0.015 250);">Mon–Sat, 5am–9pm</span>' +
      '<span style="font:500 15px/1 Figtree,sans-serif;color:oklch(0.40 0.015 250);">Sunday by appointment</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;"><span style="font:600 11px/1 Barlow,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:oklch(0.62 0.11 237);">Team</span>' +
      '<a href="' + root + 'driver/" style="font:500 15px/1 Figtree,sans-serif;">Driver sign-in</a>' +
      '<a href="' + root + 'owner/" style="font:500 15px/1 Figtree,sans-serif;">Dispatch sign-in</a></div>' +
      '</div></div>' +
      '<div style="border-top:1px solid oklch(0.96 0.006 250);"><div style="max-width:1180px;margin:0 auto;padding:20px 32px;font:400 13px/1 Figtree,sans-serif;color:oklch(0.62 0.012 250);">© 2026 I Served Transportation LLC. All rights reserved.</div></div></footer>';
  }

  function sidebar(root, active, sub, items) {
    var me = ME || { name: "", role: "" };
    var nav = items.map(function (it) {
      var on = it.id === active;
      return '<a href="' + it.href + '" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:9px;font:500 15px/1 Figtree,sans-serif;' +
        (on ? 'background:rgba(255,255,255,0.14);box-shadow:inset 3px 0 0 oklch(0.72 0.10 237);color:#fff;' : 'color:rgba(255,255,255,0.78);') + '">' +
        '<span>' + it.label + '</span>' + (it.badge ? '<span style="padding:4px 8px;border-radius:999px;background:oklch(0.62 0.115 237);font:700 11px/1 Figtree,sans-serif;color:#fff;">' + it.badge + '</span>' : '') + '</a>';
    }).join('');
    return '<aside style="background:oklch(0.32 0.03 248);padding:24px 18px;display:flex;flex-direction:column;gap:26px;min-height:100vh;">' +
      '<a href="' + root + '" style="padding:0 8px;color:inherit;">' + logo(26, true, sub) + '</a>' +
      '<div style="display:flex;flex-direction:column;gap:4px;">' + nav + '</div>' +
      '<div style="margin-top:auto;display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:12px;background:rgba(255,255,255,0.07);">' +
      '<div style="display:flex;flex-direction:column;gap:2px;"><span style="font:600 14px/1.3 Figtree,sans-serif;color:#fff;">' + (me.name || "") + '</span>' +
      '<span style="font:400 12px/1.3 Figtree,sans-serif;color:rgba(255,255,255,0.55);">' + (me.role === "owner" ? "Owner" : me.role === "driver" ? "Driver" : "") + '</span></div>' +
      '<button onclick="ISV.auth.signOutTo(\'' + root + '\')" style="cursor:pointer;background:none;padding:9px;border:1px solid rgba(255,255,255,0.28);border-radius:8px;font:600 13px/1 Figtree,sans-serif;color:#fff;text-align:center;">Sign out</button>' +
      '</div></aside>';
  }

  function pill(status) {
    var map = {
      "New":       ["oklch(0.95 0.025 237)", "oklch(0.45 0.10 240)"],
      "Assigned":  ["oklch(0.96 0.03 85)",   "oklch(0.50 0.10 75)"],
      "Accepted":  ["oklch(0.96 0.03 85)",   "oklch(0.50 0.10 75)"],
      "En route":  ["oklch(0.94 0.05 160)",  "oklch(0.42 0.10 160)"],
      "Picked up": ["oklch(0.94 0.05 160)",  "oklch(0.42 0.10 160)"],
      "Completed": ["oklch(0.95 0.006 250)", "oklch(0.45 0.015 250)"],
      "Cancelled": ["oklch(0.95 0.02 20)",   "oklch(0.50 0.15 25)"]
    };
    var c = map[status] || map["New"];
    return '<span style="padding:5px 11px;border-radius:999px;background:' + c[0] + ';font:600 12px/1 Figtree,sans-serif;color:' + c[1] + ';white-space:nowrap;">' + status + '</span>';
  }

  function fmtDate(d) {
    if (!d) return "TBD";
    var p = d.split("-"); if (p.length !== 3) return d;
    var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1] - 1];
    return mo + " " + (+p[2]);
  }
  function fmtTime(t) {
    if (!t) return "TBD";
    var p = t.split(":"), h = +p[0], m = p[1];
    var ap = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
    return h + ":" + m + " " + ap;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function tripLine(b) { return vehicleShort(b.vehicle) + " · " + (b.tripType === "round" ? "round trip" : "one way") + " · " + (b.miles || 0) + " mi"; }

  window.ISV = {
    root: "", ready: ready, auth: AUTH, book: BOOK,
    onChange: function (fn) { changeHandlers.push(fn); },
    bootstrapped: function () { return BOOTSTRAPPED; },
    dbError: function () { return DBERROR; },
    money: money, fare: fare, vehicleName: vehicleName, vehicleShort: vehicleShort,
    logo: logo, header: header, footer: footer, sidebar: sidebar, pill: pill,
    fmtDate: fmtDate, fmtTime: fmtTime, esc: esc, tripLine: tripLine
  };
})();
