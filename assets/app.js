/* ============================================================
   I SERVED TRANSPORTATION — core (accounts, data, fare, shared UI)
   Data lives in this browser's localStorage. That makes the whole
   site fully functional as a demo on one device. To sync accounts
   and bookings across every phone/laptop for real, swap the DB
   functions below for Firebase (see README.txt). Page code and
   designs need zero changes.
   ============================================================ */
(function () {
  var C = window.CONFIG;

  /* ---------------- tiny db ---------------- */
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  var DB = {
    users: function () { return load("isv_users", []); },
    saveUsers: function (u) { save("isv_users", u); },
    grants: function () { return load("isv_grants", {}); },        // email -> role granted by owner before signup
    saveGrants: function (g) { save("isv_grants", g); },
    profiles: function () { return load("isv_profiles", {}); },    // email -> {vehicle, cred, phone, active}
    saveProfiles: function (p) { save("isv_profiles", p); },
    bookings: function () { return load("isv_bookings", []); },
    saveBookings: function (b) { save("isv_bookings", b); }
  };

  /* ---------------- auth ---------------- */
  async function hash(str) {
    try {
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("isv$" + str));
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    } catch (e) { // file:// fallback
      var h = 0; str = "isv$" + str;
      for (var i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
      return "x" + h;
    }
  }
  function norm(email) { return String(email || "").trim().toLowerCase(); }

  var AUTH = {
    me: function () {
      var s = load("isv_session", null);
      if (!s) return null;
      var u = DB.users().find(function (x) { return x.email === s; });
      return u || null;
    },
    register: async function (name, email, phone, password) {
      email = norm(email);
      if (!name || !email || !password) throw "Fill in name, email, and password.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw "That email doesn't look right.";
      if (password.length < 4) throw "Password needs at least 4 characters.";
      var users = DB.users();
      if (users.find(function (u) { return u.email === email; })) throw "An account with that email already exists — sign in instead.";
      var role = "client";
      if (users.length === 0) role = "owner"; // first account on the site = owner
      if ((C.OWNER_EMAILS || []).map(norm).indexOf(email) > -1) role = "owner";
      var g = DB.grants();
      if (g[email]) role = g[email]; // owner pre-assigned this email a role
      users.push({ name: name.trim(), email: email, phone: (phone || "").trim(), pass: await hash(password), role: role, created: Date.now() });
      DB.saveUsers(users);
      save("isv_session", email);
      return role;
    },
    signIn: async function (email, password) {
      email = norm(email);
      var u = DB.users().find(function (x) { return x.email === email; });
      if (!u) throw "No account with that email. Create one below.";
      if (u.pass !== await hash(password)) throw "Wrong password.";
      save("isv_session", email);
      return u;
    },
    signOut: function () { localStorage.removeItem("isv_session"); },
    setRole: function (email, role) {           // owner action; works even before that email registers
      email = norm(email);
      var users = DB.users(), u = users.find(function (x) { return x.email === email; });
      if (u) { u.role = role; DB.saveUsers(users); }
      var g = DB.grants(); g[email] = role; DB.saveGrants(g);
    },
    removeRole: function (email) {
      email = norm(email);
      var users = DB.users(), u = users.find(function (x) { return x.email === email; });
      if (u) { u.role = "client"; DB.saveUsers(users); }
      var g = DB.grants(); delete g[email]; DB.saveGrants(g);
    },
    accounts: function () {
      // merge real users + pending grants (invited, not yet registered)
      var users = DB.users().slice();
      var g = DB.grants();
      Object.keys(g).forEach(function (email) {
        if (!users.find(function (u) { return u.email === email; }))
          users.push({ name: "(invited — hasn't created account yet)", email: email, role: g[email], pending: true });
      });
      return users;
    },
    profile: function (email) { return DB.profiles()[norm(email)] || {}; },
    saveProfile: function (email, patch) {
      var p = DB.profiles(); email = norm(email);
      p[email] = Object.assign({}, p[email] || {}, patch);
      DB.saveProfiles(p);
    },
    drivers: function () { // all accounts with role driver (or owner acting as driver profile) that are staff
      return AUTH.accounts().filter(function (u) { return u.role === "driver" || u.role === "owner"; })
        .map(function (u) { var pr = AUTH.profile(u.email); return Object.assign({}, u, pr, { active: pr.active !== false }); });
    },
    require: function (role, next) { // gate a page
      var me = AUTH.me();
      if (!me) { location.href = ISV.root + "account/?next=" + encodeURIComponent(next || location.pathname); return null; }
      if (role === "owner" && me.role !== "owner") { location.href = ISV.root + "account/?denied=owner"; return null; }
      if (role === "driver" && me.role !== "driver" && me.role !== "owner") { location.href = ISV.root + "account/?denied=driver"; return null; }
      return me;
    }
  };

  /* ---------------- bookings ---------------- */
  var BOOK = {
    all: function () { return DB.bookings().sort(function (a, b) { return (a.date || "") < (b.date || "") ? -1 : 1; }); },
    byId: function (id) { return DB.bookings().find(function (b) { return b.id === id; }); },
    add: function (b) {
      var all = DB.bookings();
      b.id = "IST-" + Math.floor(100000 + Math.random() * 899999);
      b.created = Date.now();
      b.status = "New";
      b.driverEmail = null;
      b.log = [{ t: Date.now(), text: "Requested online — form submitted with estimate " + ISV.money(b.fare) }];
      all.push(b); DB.saveBookings(all);
      return b;
    },
    update: function (id, patch, logText) {
      var all = DB.bookings(), b = all.find(function (x) { return x.id === id; });
      if (!b) return;
      Object.assign(b, patch);
      if (logText) { b.log = b.log || []; b.log.push({ t: Date.now(), text: logText }); }
      DB.saveBookings(all);
    },
    mine: function (me) { // bookings belonging to a signed-in client
      if (!me) return [];
      return BOOK.all().filter(function (b) { return b.userEmail === me.email; });
    },
    forDriver: function (email) {
      return BOOK.all().filter(function (b) { return b.driverEmail === norm(email) && b.status !== "Cancelled"; });
    }
  };

  /* ---------------- fare ---------------- */
  function money(n) { return "$" + Number(n).toFixed(2); }
  function fare(s) { // s: {tripType, miles, vehicle, addOns:{wait,assist,afterHours}}
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

  function header(root) {
    var me = AUTH.me();
    var acct;
    if (!me) acct = '<a href="' + root + 'account/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Sign in</a>';
    else {
      var links = '<a href="' + root + 'my-rides/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">My rides</a>';
      if (me.role === "driver") links += '<a href="' + root + 'driver/rides/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Driver console</a>';
      if (me.role === "owner") links += '<a href="' + root + 'owner/dashboard/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Dispatch console</a>';
      acct = links;
    }
    return '<header style="position:sticky;top:0;z-index:20;background:rgba(255,255,255,0.92);backdrop-filter:blur(10px);border-bottom:1px solid oklch(0.93 0.01 250);">' +
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
    var me = AUTH.me() || { name: "", role: "" };
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
      '<button onclick="ISV.auth.signOut();location.href=\'' + root + '\'" style="cursor:pointer;background:none;padding:9px;border:1px solid rgba(255,255,255,0.28);border-radius:8px;font:600 13px/1 Figtree,sans-serif;color:#fff;text-align:center;">Sign out</button>' +
      '</div></aside>';
  }

  /* status pill colors used across consoles */
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

  function fmtDate(d) { // "2026-08-03" -> "Aug 3"
    if (!d) return "—";
    var p = d.split("-"); if (p.length !== 3) return d;
    var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1] - 1];
    return mo + " " + (+p[2]);
  }
  function fmtTime(t) { // "10:00" -> "10:00 AM"
    if (!t) return "—";
    var p = t.split(":"), h = +p[0], m = p[1];
    var ap = h >= 12 ? "PM" : "AM"; h = h % 12; if (h === 0) h = 12;
    return h + ":" + m + " " + ap;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function tripLine(b) { return vehicleShort(b.vehicle) + " · " + (b.tripType === "round" ? "round trip" : "one way") + " · " + b.miles + " mi"; }

  window.ISV = {
    root: "", db: DB, auth: AUTH, book: BOOK,
    money: money, fare: fare, vehicleName: vehicleName, vehicleShort: vehicleShort,
    logo: logo, header: header, footer: footer, sidebar: sidebar, pill: pill,
    fmtDate: fmtDate, fmtTime: fmtTime, esc: esc, tripLine: tripLine
  };
})();
