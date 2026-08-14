/* ============================================================
   I SERVED TRANSPORTATION - core (Firebase edition)
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
  try { db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) {}
  var FV = firebase.firestore.FieldValue;

  /* ---------------- live cache ---------------- */
  var ME = null;              // {uid, email, name, phone, role}
  var BOOKINGS = [];          // visible bookings for this account's role
  var USERS = [];             // all user docs (owners only)
  var GRANTS = {};            // email -> {role, vehicle, cred, phone, active} (owners + own)
  var PAYMENTS = {};          // email -> [payment records]  (OWNER ONLY)
  var PAYMENTS_OK = true;     // false when the payments rules aren't published yet
  var BOOTSTRAPPED = false;   // does the site have its first owner yet
  var DBERROR = null;
  var DRIVER_QUERY_OK = null;   // null = not answered yet, false = blocked
  var unsubs = [];
  var changeHandlers = [];

  function norm(email) { return String(email || "").trim().toLowerCase(); }
  function fireChange() { changeHandlers.forEach(function (f) { try { f(); } catch (e) {} }); }
  function friendly(e) {
    var code = (e && e.code) || "";
    if (code.indexOf("permission-denied") > -1) return "Your database rules need updating - open firestore.rules from the site folder and re-paste it into Firebase (Firestore Database > Rules > Publish).";
    if (code.indexOf("email-already-in-use") > -1) return "An account with that email already exists - sign in instead.";
    if (code.indexOf("invalid-credential") > -1 || code.indexOf("wrong-password") > -1 || code.indexOf("user-not-found") > -1) return "Email or password doesn't match an account.";
    if (code.indexOf("weak-password") > -1) return "Password needs at least 6 characters.";
    if (code.indexOf("invalid-email") > -1) return "That email doesn't look right.";
    if (code.indexOf("network") > -1) return "Network problem - check the connection and try again.";
    if (code === "timeout") return "The database connection is being blocked on this network (ad blockers and some wifi networks do this). Try turning off the ad blocker for this site, or a different network.";
    return (e && e.message) || String(e);
  }

  /* ------- REST fallback (plain HTTPS; survives ad blockers / strict networks) ------- */
  var REST = "https://firestore.googleapis.com/v1/projects/" + C.FIREBASE.projectId + "/databases/(default)/documents";
  function fsVal(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return (isFinite(v) && Math.floor(v) === v) ? { integerValue: String(v) } : { doubleValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
    if (typeof v === "object") return { mapValue: { fields: fsFields(v) } };
    return { stringValue: String(v) };
  }
  function fsFields(obj) { var f = {}; Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) f[k] = fsVal(obj[k]); }); return f; }
  function fromFsVal(v) {
    if (!v) return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return +v.integerValue;
    if ("doubleValue" in v) return v.doubleValue;
    if ("stringValue" in v) return v.stringValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsVal);
    if ("mapValue" in v) return fromFsFields(v.mapValue.fields || {});
    return null;
  }
  function fromFsFields(fields) { var o = {}; Object.keys(fields || {}).forEach(function (k) { o[k] = fromFsVal(fields[k]); }); return o; }
  function authHeaders() {
    var u = fbAuth.currentUser;
    return (u ? u.getIdToken() : Promise.resolve(null)).then(function (t) {
      var h = { "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t; return h;
    }, function () { return { "Content-Type": "application/json" }; });
  }
  function restErr(r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      throw { code: ((j.error && j.error.status) || "rest-error").toLowerCase().replace("_", "-"), message: j.error && j.error.message };
    });
  }
  function restPatch(col, id, data, maskKeys) {
    return authHeaders().then(function (h) {
      var url = REST + "/" + col + "/" + encodeURIComponent(id);
      if (maskKeys && maskKeys.length) url += "?" + maskKeys.map(function (k) { return "updateMask.fieldPaths=" + encodeURIComponent(k); }).join("&");
      return fetch(url, { method: "PATCH", headers: h, body: JSON.stringify({ fields: fsFields(data) }) });
    }).then(function (r) { if (!r.ok) return restErr(r); });
  }
  function restDelete(col, id) {
    return authHeaders().then(function (h) {
      return fetch(REST + "/" + col + "/" + encodeURIComponent(id), { method: "DELETE", headers: h });
    }).then(function (r) { if (!r.ok) return restErr(r); });
  }
  function restGet(col, id) {
    return authHeaders().then(function (h) {
      return fetch(REST + "/" + col + "/" + encodeURIComponent(id), { headers: h });
    }).then(function (r) {
      if (r.status === 404) return { exists: false, data: function () { return undefined; } };
      if (!r.ok) return restErr(r);
      return r.json().then(function (j) { var d = fromFsFields(j.fields); return { exists: true, data: function () { return d; } }; });
    });
  }
  function restListAll(col) {
    return authHeaders().then(function (h) {
      return fetch(REST + "/" + col + "?pageSize=300", { headers: h });
    }).then(function (r) {
      if (!r.ok) return restErr(r);
      return r.json().then(function (j) {
        return (j.documents || []).map(function (d) {
          var o = fromFsFields(d.fields); o.__docId = d.name.split("/").pop(); return o;
        });
      });
    });
  }
  function restWhere(col, field, value) {
    return authHeaders().then(function (h) {
      return fetch(REST.replace(/\/documents$/, "") + "/documents:runQuery", {
        method: "POST", headers: h,
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: fsVal(value) } } } })
      });
    }).then(function (r) {
      if (!r.ok) return restErr(r);
      return r.json().then(function (arr) {
        return arr.filter(function (x) { return x.document; }).map(function (x) {
          var o = fromFsFields(x.document.fields); o.__docId = x.document.name.split("/").pop(); return o;
        });
      });
    });
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej({ code: "timeout" }); }, ms); })]);
  }

  /* ------- fallback polling when the realtime channel never connects ------- */
  var pollTimer = null;
  function startPolling() {
    if (pollTimer || !ME) return;
    function tick() {
      if (ME.role === "owner") {
        restListAll("bookings").then(function (list) { BOOKINGS = list.map(function (b) { b.id = b.id || b.__docId; return b; }); fireChange(); }).catch(function () {});
        restListAll("users").then(function (list) { USERS = list.map(function (u) { u.uid = u.__docId; return u; }); fireChange(); }).catch(function () {});
        restListAll("grants").then(function (list) { GRANTS = {}; list.forEach(function (g) { GRANTS[g.__docId] = g; }); fireChange(); }).catch(function () {});
      } else {
        var jobs = [restWhere("bookings", "userEmail", ME.email)];
        if (ME.role === "driver") jobs.push(restWhere("bookings", "driverEmail", ME.email));
        Promise.all(jobs).then(function (results) {
          var seen = {}, out = [];
          results.forEach(function (list) { list.forEach(function (b) { b.id = b.id || b.__docId; if (!seen[b.id]) { seen[b.id] = 1; out.push(b); } }); });
          BOOKINGS = out; fireChange();
        }).catch(function () {});
      }
    }
    tick();
    pollTimer = setInterval(tick, 5000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function clearSubs() { unsubs.forEach(function (u) { try { u(); } catch (e) {} }); unsubs = []; stopPolling(); }

  function subscribe() {
    clearSubs();
    BOOKINGS = []; USERS = []; GRANTS = {}; PAYMENTS = {};
    if (!ME) { fireChange(); return Promise.resolve(); }
    var firsts = [];
    var gotSnapshot = false;
    function sub(q, apply) {
      var resolveFirst; var p = new Promise(function (res) { resolveFirst = res; });
      firsts.push(p);
      unsubs.push(q.onSnapshot(function (snap) {
        gotSnapshot = true; stopPolling();
        apply(snap); resolveFirst(); fireChange();
      }, function (err) { DBERROR = friendly(err); DRIVER_QUERY_OK = false; resolveFirst(); fireChange(); }));
    }
    setTimeout(function () { if (!gotSnapshot && ME) startPolling(); }, 8000);
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
      // optional collection: if the rules for it aren't published yet the
      // rest of the console still works, so this failure stays quiet.
      unsubs.push(db.collection("payments").onSnapshot(function (snap) {
        PAYMENTS = {}; snap.docs.forEach(function (d) { PAYMENTS[d.id] = (d.data() || {}).list || []; });
        PAYMENTS_OK = true; fireChange();
      }, function () { PAYMENTS_OK = false; fireChange(); }));
    } else if (ME.role === "driver") {
      // Two queries feed one list: rides assigned to them, plus rides they
      // booked as a customer. Keep them in separate buckets and merge, or
      // whichever snapshot lands last wipes the other one out.
      var assignedBucket = [], ownBucket = [];
      function mergeBuckets() {
        var seen = {}; BOOKINGS = [];
        assignedBucket.concat(ownBucket).forEach(function (b) {
          if (!seen[b.id]) { seen[b.id] = 1; BOOKINGS.push(b); }
        });
      }
      sub(db.collection("bookings").where("driverEmail", "==", ME.email), function (snap) {
        assignedBucket = snap.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
        DRIVER_QUERY_OK = true;
        mergeBuckets();
      });
      sub(db.collection("bookings").where("userEmail", "==", ME.email), function (snap) {
        ownBucket = snap.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
        mergeBuckets();
      });
    } else {
      sub(db.collection("bookings").where("userEmail", "==", ME.email), applyBookings);
    }
    return withTimeout(Promise.all(firsts), 9000).catch(function () { startPolling(); });
  }

  function loadMe(fbUser) {
    if (!fbUser) { ME = null; return Promise.resolve(null); }
    return withTimeout(db.collection("users").doc(fbUser.uid).get(), 6000)
      .catch(function (e) { if (e && e.code === "timeout") return restGet("users", fbUser.uid); throw e; })
      .then(function (doc) {
      if (doc.exists) {
        var d = doc.data();
        ME = { uid: fbUser.uid, email: norm(d.email || fbUser.email), name: d.name || "", phone: d.phone || "", role: d.role || "client", photo: d.photo || "" };
        // pending grant elevation (owner promoted this email after signup)
        return withTimeout(db.collection("grants").doc(ME.email).get(), 5000)
          .catch(function (e) { if (e && e.code === "timeout") return restGet("grants", ME.email); throw e; })
          .then(function (g) {
            if (g.exists) GRANTS[ME.email] = Object.assign({}, GRANTS[ME.email] || {}, g.data()); // own profile (alert topic etc.)
            if (g.exists && g.data().role && g.data().role !== ME.role) {
              var newRole = g.data().role;
              return withTimeout(db.collection("users").doc(ME.uid).update({ role: newRole }), 6000)
                .catch(function (e) { if (e && e.code === "timeout") return restPatch("users", ME.uid, { role: newRole }, ["role"]); throw e; })
                .then(function () { ME.role = newRole; return ME; })
                .catch(function () { return ME; });
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
        withTimeout(db.collection("meta").doc("bootstrap").get(), 5000)
          .catch(function (e) { if (e && e.code === "timeout") return restGet("meta", "bootstrap"); throw e; })
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
          var g = await withTimeout(db.collection("grants").doc(email).get(), 5000)
            .catch(function (e) { if (e && e.code === "timeout") return restGet("grants", email); throw e; });
          if (g.exists && g.data().role) role = g.data().role;
        } catch (e) {}
        var boot = false;
        if (role === "client") {
          try {
            var b = await withTimeout(db.collection("meta").doc("bootstrap").get(), 5000)
              .catch(function (e) { if (e && e.code === "timeout") return restGet("meta", "bootstrap"); throw e; });
            if (!b.exists) { role = "owner"; boot = true; }
          } catch (e) {}
          if (!BOOTSTRAPPED && (C.OWNER_EMAILS || []).map(norm).indexOf(email) > -1) { role = "owner"; boot = true; }
        }
        var userDoc = { name: name.trim(), email: email, phone: (phone || "").trim(), role: role, created: Date.now() };
        var batch = db.batch();
        batch.set(db.collection("users").doc(cred.user.uid), userDoc);
        if (boot) batch.set(db.collection("meta").doc("bootstrap"), { uid: cred.user.uid, t: Date.now() });
        try {
          await withTimeout(batch.commit(), 8000);
        } catch (e) {
          if (e && e.code === "timeout") {
            await restPatch("users", cred.user.uid, userDoc);
            if (boot) await restPatch("meta", "bootstrap", { uid: cred.user.uid, t: Date.now() });
          } else throw e;
        }
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
      var jobs = [withTimeout(db.collection("grants").doc(email).set(data, { merge: true }), 8000)
        .catch(function (e) { if (e && e.code === "timeout") return restPatch("grants", email, data, Object.keys(data)); throw e; })];
      var u = USERS.find(function (x) { return norm(x.email) === email; });
      if (u) {
        u.role = role;
        jobs.push(withTimeout(db.collection("users").doc(u.uid).update({ role: role }), 8000)
          .catch(function (e) { if (e && e.code === "timeout") return restPatch("users", u.uid, { role: role }, ["role"]); throw e; }));
      }
      fireChange();
      return Promise.all(jobs).catch(function (e) { alert(friendly(e)); });
    },
    removeRole: function (email) {
      email = norm(email);
      delete GRANTS[email];
      var jobs = [withTimeout(db.collection("grants").doc(email).delete(), 8000)
        .catch(function (e) { if (e && e.code === "timeout") return restDelete("grants", email); throw e; })];
      var u = USERS.find(function (x) { return norm(x.email) === email; });
      if (u) {
        u.role = "client";
        jobs.push(withTimeout(db.collection("users").doc(u.uid).update({ role: "client" }), 8000)
          .catch(function (e) { if (e && e.code === "timeout") return restPatch("users", u.uid, { role: "client" }, ["role"]); throw e; }));
      }
      fireChange();
      return Promise.all(jobs).catch(function (e) { alert(friendly(e)); });
    },
    saveProfile: function (email, patch) {
      email = norm(email);
      GRANTS[email] = Object.assign({}, GRANTS[email] || {}, patch);
      fireChange();
      return withTimeout(db.collection("grants").doc(email).set(patch, { merge: true }), 8000)
        .catch(function (e) { if (e && e.code === "timeout") return restPatch("grants", email, patch, Object.keys(patch)); throw e; })
        .catch(function (e) { alert(friendly(e)); });
    },
    accounts: function () {
      var list = USERS.map(function (u) { return { name: u.name, email: norm(u.email), phone: u.phone, role: u.role || "client", uid: u.uid, photo: u.photo || "" }; });
      Object.keys(GRANTS).forEach(function (email) {
        if (!list.find(function (u) { return u.email === email; }))
          list.push({ name: "(invited - hasn't created account yet)", email: email, role: GRANTS[email].role || "driver", pending: true });
      });
      return list;
    },
    profile: function (email) { return GRANTS[norm(email)] || {}; },
    // Payment history: owner-only collection. Drivers cannot read this at all.
    payments: function (email) { return (PAYMENTS[norm(email)] || []).slice().sort(function (a, b) { return b.t - a.t; }); },
    updatePayment: function (email, id, patch) {
      email = norm(email);
      var list = (PAYMENTS[email] || []).map(function (p) { return p.id === id ? Object.assign({}, p, patch) : p; });
      PAYMENTS[email] = list;
      fireChange();
      return withTimeout(db.collection("payments").doc(email).set({ list: list }, { merge: true }), 8000)
        .catch(function (e) { if (e && e.code === "timeout") return restPatch("payments", email, { list: list }, ["list"]); throw e; })
        .catch(function (e) { alert(friendly(e)); });
    },
    // Pull payment records straight from the server. The invoice page uses
    // this so it never renders "not found" just because the live cache
    // hasn't caught up yet.
    fetchPayments: function (email) {
      email = norm(email);
      return restGet("payments", email).then(function (doc) {
        var list = (doc.exists ? (doc.data() || {}).list : []) || [];
        PAYMENTS[email] = list;
        fireChange();
        return list;
      }).catch(function () { return PAYMENTS[email] || []; });
    },
    addPayment: function (email, rec) {
      email = norm(email);
      var list = (PAYMENTS[email] || []).concat([rec]);
      PAYMENTS[email] = list; // optimistic
      fireChange();
      return withTimeout(db.collection("payments").doc(email).set({ list: list }, { merge: true }), 8000)
        .catch(function (e) { if (e && e.code === "timeout") return restPatch("payments", email, { list: list }, ["list"]); throw e; })
        .catch(function (e) { alert(friendly(e)); });
    },
    drivers: function () {
      return AUTH.accounts().filter(function (u) { return u.role === "driver" || u.role === "owner"; })
        .map(function (u) { var pr = AUTH.profile(u.email); return Object.assign({}, u, pr, { active: pr.active !== false }); });
    },
    // A person editing their own name/phone/photo. Writes to their user doc
    // so it shows up everywhere their name appears.
    updateMe: function (patch) {
      if (!ME) return Promise.reject("Not signed in.");
      var clean = {};
      if (patch.name != null) clean.name = String(patch.name).trim();
      if (patch.phone != null) clean.phone = String(patch.phone).trim();
      if (patch.photo != null) clean.photo = patch.photo;
      Object.assign(ME, clean); // optimistic
      var u = USERS.find(function (x) { return x.uid === ME.uid; });
      if (u) Object.assign(u, clean);
      fireChange();
      return withTimeout(db.collection("users").doc(ME.uid).update(clean), 8000)
        .catch(function (e) { if (e && e.code === "timeout") return restPatch("users", ME.uid, clean, Object.keys(clean)); throw e; })
        .then(function () {
          // keep the driver profile phone in step so dispatch can text them
          if (clean.phone && (ME.role === "driver" || ME.role === "owner")) {
            return AUTH.saveProfile(ME.email, { phone: clean.phone });
          }
        })
        .catch(function (e) { throw friendly(e); });
    },
    photoFor: function (email) {
      var u = AUTH.accounts().find(function (x) { return x.email === norm(email); });
      return (u && u.photo) || "";
    },
    require: function (role, next) {
      if (!ME) { location.href = ISV.root + "account/?next=" + encodeURIComponent(next || location.pathname); return null; }
      if (role === "owner" && ME.role !== "owner") { location.href = ISV.root + "account/?denied=owner"; return null; }
      if (role === "driver" && ME.role !== "driver" && ME.role !== "owner") { location.href = ISV.root + "account/?denied=driver"; return null; }
      return ME;
    }
  };

  /* ---------------- email alerts (keyless, via FormSubmit) ---------------- */
  function sendEmail(subject, body) {
    var to = C.NOTIFY_EMAIL;
    if (!to) return Promise.resolve();
    return fetch("https://formsubmit.co/ajax/" + encodeURIComponent(to), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ _subject: subject, _template: "table", message: body })
    }).catch(function () {});
  }
  function rideBlurb(b) {
    return [
      "Ride " + b.id,
      "Passenger: " + (b.name || "-") + "  " + (b.phone || ""),
      "Service: " + (serviceLabel(b.service) || vehicleShort(b.vehicle)),
      "When: " + fmtDate(b.date) + " at " + fmtTime(b.time),
      "Pickup: " + (b.pickup || "-"),
      "Drop-off: " + (b.dropoff || "-"),
      "Trip: " + (b.tripType === "round" ? "Round trip" : "One way") + ", " + (b.miles || 0) + " mi",
      "Fare estimate: " + money(b.fare),
      b.notes ? "Notes: " + b.notes : ""
    ].filter(Boolean).join("\n");
  }
  function notifyNewBooking(b) {
    return sendEmail("New ride request " + b.id + " - " + (b.name || ""), rideBlurb(b));
  }
  function notifyAccepted(b, driverName) {
    return sendEmail("Ride " + b.id + " accepted by " + driverName, driverName + " accepted this ride.\n\n" + rideBlurb(b));
  }
  function notifyDeclined(b, driverName, reason) {
    return sendEmail("Ride " + b.id + " declined by " + driverName,
      driverName + " can't take this ride." + (reason ? "\nReason: " + reason : "") + "\nIt needs reassigning.\n\n" + rideBlurb(b));
  }
  /* prefilled SMS / call links for texting drivers from the console */
  function telHref(phone) { return "tel:" + String(phone || "").replace(/[^0-9+]/g, ""); }
  function smsHref(phone, body) {
    var num = String(phone || "").replace(/[^0-9+]/g, "");
    var ua = navigator.userAgent || "";
    var sep = /iPhone|iPad|iPod|Macintosh/i.test(ua) ? "&" : "?";
    return "sms:" + num + sep + "body=" + encodeURIComponent(body);
  }
  function driverRideText(b, driverName) {
    return (driverName ? driverName + ", " : "") + "you've got a ride from " + C.COMPANY + ".\n" +
      fmtDate(b.date) + " at " + fmtTime(b.time) + "\n" +
      (b.name || "Passenger") + (b.phone ? " (" + b.phone + ")" : "") + "\n" +
      "Pickup: " + (b.pickup || "-") + "\n" +
      "Drop-off: " + (b.dropoff || "-") + "\n" +
      (serviceLabel(b.service) || vehicleShort(b.vehicle)) + ", " + (b.tripType === "round" ? "round trip" : "one way") + "\n" +
      (b.notes ? "Notes: " + b.notes + "\n" : "") +
      "Ride " + b.id + " - open your driver console to accept.";
  }

  /* ---------------- bookings ---------------- */
  function newId() { return "IST-" + Math.floor(100000 + Math.random() * 899999); }
  var BOOK = {
    all: function () { return BOOKINGS.filter(function (b) { return !b.deleted; }); },
    trash: function () { return BOOKINGS.filter(function (b) { return b.deleted; }); },
    moveToTrash: function (id, by) { BOOK.update(id, { deleted: true }, "Moved to trash" + (by ? " by " + by : "")); },
    restore: function (id, by) { BOOK.update(id, { deleted: false }, "Restored from trash" + (by ? " by " + by : "")); },
    clearTrash: function () { // permanently delete everything in the trash
      var doomed = BOOK.trash().map(function (b) { return b.id; });
      BOOKINGS = BOOKINGS.filter(function (b) { return !b.deleted; });
      fireChange();
      var chain = Promise.resolve();
      doomed.forEach(function (id) {
        chain = chain.then(function () {
          return withTimeout(db.collection("bookings").doc(id).delete(), 8000)
            .catch(function (e) { if (e && e.code === "timeout") return restDelete("bookings", id); throw e; });
        });
      });
      return chain.catch(function (e) { alert("Couldn't clear the trash: " + friendly(e)); });
    },
    byId: function (id) {
      var b = BOOKINGS.find(function (x) { return x.id === id; });
      if (b) return b;
      try { var last = JSON.parse(sessionStorage.getItem("isv_last_booking") || "null"); if (last && last.id === id) return last; } catch (e) {}
      return null;
    },
    _prep: function (b) {
      b.id = newId();
      b.created = Date.now();
      b.status = b.status || (b.createdByOwner ? "New" : "Pending");
      b.driverEmail = b.driverEmail || null;
      b.userEmail = b.userEmail ? norm(b.userEmail) : null;
      b.log = b.log || [{ t: Date.now(), text: "Requested online - form submitted with estimate " + ISV.money(b.fare || 0) }];
      return b;
    },
    add: function (b) { // optimistic, used for owner-side seeds
      BOOK._prep(b);
      BOOKINGS.push(b);
      try { sessionStorage.setItem("isv_last_booking", JSON.stringify(b)); } catch (e) {}
      db.collection("bookings").doc(b.id).set(b).catch(function (e) { alert("Couldn't save the booking: " + friendly(e)); });
      fireChange();
      return b;
    },
    // A round trip is stored as two separate one-way rides: A Leg out and
    // B Leg back. Same total money, but each leg can be assigned, driven,
    // completed and invoiced on its own.
    addTripAsync: function (b) {
      if (b.tripType !== "round") {
        b.leg = b.leg || "A";
        return BOOK.addAsync(b).then(function (saved) { return [saved]; });
      }
      var group = "GRP-" + Math.floor(100000 + Math.random() * 899999);
      var oneWayMiles = Math.round((Number(b.miles || 0) / 2) * 10) / 10;
      function legFare(v) {
        var f = fare({ vehicle: b.vehicle, tripType: "oneway", miles: oneWayMiles, addOns: b.addOns });
        return +f.total.toFixed(2);
      }
      var legA = Object.assign({}, b, {
        tripType: "oneway", leg: "A", groupId: group,
        miles: oneWayMiles, fare: legFare(),
        notes: b.notes || ""
      });
      var legB = Object.assign({}, b, {
        tripType: "oneway", leg: "B", groupId: group,
        pickup: b.dropoff, dropoff: b.pickup,
        pickupCoords: b.dropoffCoords, dropoffCoords: b.pickupCoords,
        miles: oneWayMiles, fare: legFare(),
        notes: b.notes || ""
      });
      return BOOK.addAsync(legA).then(function (a) {
        return BOOK.addAsync(legB).then(function (bb) { return [a, bb]; });
      });
    },
    addAsync: function (b) { // waits for the database to CONFIRM before resolving
      BOOK._prep(b);
      return withTimeout(db.collection("bookings").doc(b.id).set(b), 8000)
        .catch(function (e) {
          if (e && e.code === "timeout") return restPatch("bookings", b.id, b); // blocked channel? plain HTTPS instead
          throw e;
        })
        .then(function () {
          BOOKINGS.push(b);
          try { sessionStorage.setItem("isv_last_booking", JSON.stringify(b)); } catch (e) {}
          fireChange();
          notifyNewBooking(b);
          return b;
        }, function (e) { throw friendly(e); });
    },
    update: function (id, patch, logText) {
      if (patch && patch.driverEmail) patch.driverEmail = norm(patch.driverEmail);
      if (patch && patch.userEmail) patch.userEmail = norm(patch.userEmail);
      var b = BOOKINGS.find(function (x) { return x.id === id; });
      // ride just got completed -> bill goes out once, automatically
      var justCompleted = b && patch && patch.status === "Completed" && b.status !== "Completed" && !b.billedOn;
      if (b) { Object.assign(b, patch); if (logText) { b.log = (b.log || []).concat([{ t: Date.now(), text: logText }]); } }
      var data = Object.assign({}, patch);
      if (logText) data.log = FV.arrayUnion({ t: Date.now(), text: logText });
      withTimeout(db.collection("bookings").doc(id).update(data), 8000)
        .catch(function (e) {
          if (e && e.code === "timeout") {
            var full = Object.assign({}, patch);
            if (b && logText) full.log = b.log;
            return restPatch("bookings", id, full, Object.keys(full));
          }
          throw e;
        })
        .catch(function (e) { alert("Couldn't save that change: " + friendly(e)); });
      fireChange();
      // Completing a ride sends the receipt. Charging is always a button
      // press, so cash and card rides are both handled by hand.
      if (justCompleted) setTimeout(function () { BOOK.sendReceipt(id); }, 1200);
    },
    importSet: function (docs) { // bulk import/upsert, chunked batches
      var chunks = [];
      for (var i = 0; i < docs.length; i += 400) chunks.push(docs.slice(i, i + 400));
      var chain = Promise.resolve();
      chunks.forEach(function (chunk) {
        chain = chain.then(function () {
          var batch = db.batch();
          chunk.forEach(function (d) { batch.set(db.collection("bookings").doc(d.id), d, { merge: true }); });
          return withTimeout(batch.commit(), 12000).catch(function (e) {
            if (e && e.code !== "timeout") throw e;
            var c = Promise.resolve(); // blocked channel: one-by-one over plain HTTPS
            chunk.forEach(function (d) { c = c.then(function () { return restPatch("bookings", d.id, d, Object.keys(d)); }); });
            return c;
          });
        });
      });
      return chain;
    },
    mine: function (me) {
      if (!me) return [];
      return BOOK.all().filter(function (b) { return b.userEmail === me.email; });
    },
    declinedBy: function (b) { // [{name, reason, t}] from the activity log
      return (b.log || []).filter(function (l) { return /declined by/i.test(l.text || ""); }).map(function (l) {
        var m = String(l.text).match(/Declined by ([^-]+?)(?:\s+-\s+(.*))?$/i);
        return { name: m ? m[1].trim() : "A driver", reason: m && m[2] ? m[2].trim() : "", t: l.t };
      });
    },
    assignMany: function (ids, email, driverName, byName) {
      ids.forEach(function (id) {
        BOOK.update(id, { driverEmail: norm(email), status: "Assigned", assignedAt: Date.now() },
          "Assigned to " + (driverName || email) + " by " + (byName || "dispatch"));
      });
    },
    driverCut: function (b) { return +(((b.fare || 0) * (C.DRIVER_SHARE || 0.6))).toFixed(2); },
    // completed rides for a driver: unbilled -> invoiced -> paid
    earnings: function (email) {
      email = norm(email);
      var rides = BOOK.all().filter(function (b) {
        return b.driverEmail === email && b.status === "Completed";
      });
      var paid = rides.filter(function (b) { return b.paidOn; });
      var invoiced = rides.filter(function (b) { return b.invoicedOn && !b.paidOn; });
      var unbilled = rides.filter(function (b) { return !b.invoicedOn && !b.paidOn; });
      function sum(list) { return +(list.reduce(function (s, b) { return s + BOOK.driverCut(b); }, 0)).toFixed(2); }
      return {
        rides: rides, unbilled: unbilled, invoiced: invoiced, paid: paid,
        unbilledTotal: sum(unbilled), invoicedTotal: sum(invoiced), paidTotal: sum(paid),
        owed: +(sum(unbilled) + sum(invoiced)).toFixed(2),   // everything not yet paid out
        lifetime: sum(rides)
      };
    },
    markInvoiced: function (ids, payment) {
      ids.forEach(function (id) {
        BOOK.update(id, { invoicedOn: payment.date, paymentId: payment.id },
          "Included on invoice " + payment.id);
      });
    },
    markPaid: function (ids, payment) {
      ids.forEach(function (id) {
        BOOK.update(id, { paidOn: payment.date, paymentId: payment.id },
          "Driver paid " + money(BOOK.driverCut(BOOK.byId(id) || {})) + " (payment " + payment.id + ")");
      });
    },
    // ---- what the CLIENT owes: charged when the ride is completed ----
    chargeState: function (b) {
      if (b.clientPaidOn) return "paid";
      if (b.status === "Completed") return "due";
      return "pending";
    },
    // Charges the card saved at booking. The worker checks who is calling,
    // reads the ride from the database itself, and takes the amount from
    // there - so the owner OR the assigned driver can trigger it, and the
    // amount can't be tampered with from the browser.
    chargeCard: function (id) {
      var b = BOOK.byId(id);
      if (!b) return Promise.resolve({ ok: false, reason: "Ride not found" });
      if (b.clientPaidOn) return Promise.resolve({ ok: false, reason: "Already paid" });
      if (!b.cardOnFile || !b.stripePaymentMethodId) return Promise.resolve({ ok: false, reason: "no-card" });
      if (!C.PAYMENT_API) return Promise.resolve({ ok: false, reason: "Card payments are not switched on yet." });
      var u = fbAuth.currentUser;
      if (!u) return Promise.resolve({ ok: false, reason: "Sign in again to charge cards." });
      return u.getIdToken(true).then(function (token) {
        return fetch(C.PAYMENT_API.replace(/\/$/, "") + "/charge", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify({ bookingId: b.id })
        });
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.alreadyPaid) return { ok: true };
        if (d.ok) {
          BOOK.update(id, {
            clientPaidOn: new Date().toISOString().slice(0, 10),
            clientPaidMethod: "card" + (d.last4 ? " ****" + d.last4 : ""),
            stripePaymentIntentId: d.paymentIntentId,
            chargeError: null
          }, "Card charged " + money(d.amount || b.fare) + " automatically on completion");
          return { ok: true };
        }
        var why = d.error || d.status || "declined";
        BOOK.update(id, { chargeError: why }, "Card charge failed: " + why);
        return { ok: false, reason: why };
      }).catch(function (e) {
        return { ok: false, reason: (e && e.message) || "Could not reach the payment service." };
      });
    },
    receiptText: function (b) {
      var lines = [
        C.COMPANY,
        C.PHONE_DISPLAY,
        "",
        "RECEIPT - ride " + b.id,
        fmtDate(b.date) + " at " + fmtTime(b.time),
        (legLabel(b) ? legDescription(b) : ""),
        "",
        "Passenger: " + (b.name || ""),
        "From: " + (b.pickup || ""),
        "To: " + (b.dropoff || ""),
        vehicleShort(b.vehicle) + " · " + (b.miles || 0) + " mi",
        "",
        "Total: " + money(b.fare)
      ];
      if (b.clientPaidOn) lines.push("Paid " + fmtDate(b.clientPaidOn) + (b.clientPaidMethod ? " (" + b.clientPaidMethod + ")" : ""));
      else lines.push("Amount due: " + money(b.fare), "Call " + C.PHONE_DISPLAY + " to settle up.");
      lines.push("", "Thank you for riding with " + C.COMPANY + ".");
      return lines.join("\n");
    },
    clientBillText: function (b) {
      return "Hi " + (b.name || "") + ", your ride with " + C.COMPANY + " is complete.\n\n" +
        fmtDate(b.date) + " at " + fmtTime(b.time) + "\n" +
        (b.pickup || "") + " to " + (b.dropoff || "") + "\n" +
        vehicleShort(b.vehicle) + ", " + (b.miles || 0) + " mi\n\n" +
        "Amount due: " + money(b.fare) + "\n" +
        "Ride " + b.id + "\n\n" +
        "Call " + C.PHONE_DISPLAY + " to pay or with any questions. Thank you for riding with us.";
    },
    sendReceipt: function (id, byName) {
      var b = BOOK.byId(id);
      if (!b) return Promise.resolve(false);
      var body = BOOK.receiptText(b);
      var subject = C.COMPANY + " - receipt for ride " + b.id;
      var jobs = [sendEmail(subject + " (" + (b.name || "") + ")", body)];
      if (b.userEmail) {
        jobs.push(fetch("https://formsubmit.co/ajax/" + encodeURIComponent(b.userEmail), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ _subject: subject, message: body })
        }).catch(function () {}));
      }
      BOOK.update(id, { receiptSentOn: new Date().toISOString().slice(0, 10) },
        "Receipt sent" + (b.userEmail ? " to " + b.userEmail : " to the office (no client email on file)") + (byName ? " by " + byName : ""));
      return Promise.all(jobs).then(function () { return true; });
    },
    markClientPaidCash: function (id, byName) {
      BOOK.update(id, { clientPaidOn: new Date().toISOString().slice(0, 10), clientPaidMethod: "cash" },
        "Marked paid in cash" + (byName ? " by " + byName : ""));
    },
    // Sends the bill and marks it sent. Runs automatically when a ride is
    // completed, and can be fired again by hand from the console.
    billClient: function (id, byName) {
      var b = BOOK.byId(id);
      if (!b) return Promise.resolve(false);
      var body = BOOK.clientBillText(b);
      var jobs = [];
      // always let the office know the bill is outstanding
      jobs.push(sendEmail("Payment due " + money(b.fare) + " - ride " + b.id + " (" + (b.name || "") + ")", body));
      // and email the client directly when we have their address
      if (b.userEmail) {
        jobs.push(fetch("https://formsubmit.co/ajax/" + encodeURIComponent(b.userEmail), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ _subject: C.COMPANY + " - amount due for ride " + b.id, message: body })
        }).catch(function () {}));
      }
      BOOK.update(id, { billedOn: new Date().toISOString().slice(0, 10) },
        "Bill sent" + (b.userEmail ? " to " + b.userEmail : " to the office (no client email on file)") + (byName ? " by " + byName : " automatically on completion"));
      return Promise.all(jobs).then(function () { return true; });
    },
    markClientPaid: function (id, method, byName) {
      BOOK.update(id, { clientPaidOn: new Date().toISOString().slice(0, 10), clientPaidMethod: method },
        "Client payment received (" + method + ")" + (byName ? " - recorded by " + byName : ""));
    },
    markClientUnpaid: function (id, byName) {
      BOOK.update(id, { clientPaidOn: null, clientPaidMethod: null },
        "Client payment marked unpaid" + (byName ? " by " + byName : ""));
    },
    forDriver: function (email) {
      email = norm(email);
      return BOOK.all().filter(function (b) { return b.driverEmail === email && b.status !== "Cancelled" && b.status !== "Pending"; });
    },
    approve: function (id, byName) { BOOK.update(id, { status: "New", approvedOn: Date.now() }, "Approved by " + (byName || "dispatch")); },
    reject: function (id, reason, byName) {
      BOOK.update(id, { status: "Cancelled", rejectedReason: reason || "" },
        "Declined by " + (byName || "dispatch") + (reason ? " - " + reason : ""));
    }
  };

  /* ---------------- fare ---------------- */
  function money(n) { return "$" + Number(n || 0).toFixed(2); }
  // s.miles is ALWAYS the TOTAL miles for the whole trip (both legs if round).
  // Legs only multiply the base fare. Every page passes total miles.
  function fare(s) {
    var vehicle = s.vehicle || "sedan";
    var base = (C.BASE[vehicle] != null ? C.BASE[vehicle] : C.BASE.sedan);
    var perMile = (C.PER_MILE[vehicle] != null ? C.PER_MILE[vehicle] : C.PER_MILE.sedan);
    var legs = s.tripType === "round" ? (C.ROUND_TRIP_MULTIPLIER || 2) : 1;
    var totalMiles = Math.round(Number(s.miles || 0) * 10) / 10;
    var free = C.FREE_MILES || 0;
    var billable = Math.max(0, totalMiles - free);
    var mileage = billable * perMile;
    var baseTotal = base * legs;
    var a = s.addOns || {};
    var assist = a.assist ? (C.ADDON_ASSIST || 0) : 0;
    var after = a.afterHours ? (C.ADDON_AFTERHOURS || 0) : 0;
    var rows = [];
    // detail: true = internal math (dispatch/owner). Clients see the plain summary.
    if (baseTotal > 0) rows.push({ label: (legs > 1 ? "Base fare x2 (round trip)" : "Base fare") + " - " + vehicleShort(vehicle), amount: money(baseTotal), detail: true });
    if (free > 0 && billable > 0) rows.push({ label: "First " + free + " miles", amount: "included", detail: true });
    rows.push({ label: totalMiles + " mi x " + money(perMile) + "/mi", amount: money(mileage), detail: true });
    if (assist) rows.push({ label: "Door-through-door assist", amount: money(assist) });
    if (after) rows.push({ label: "Before 6am / after 8pm", amount: money(after) });
    if (a.wait) rows.push({ label: "First hour of wait time", amount: "free" });
    var total = baseTotal + mileage + assist + after;
    var clientRows = [
      { label: vehicleShort(vehicle) + (legs > 1 ? ", round trip" : ", one way"), amount: totalMiles + " mi" }
    ];
    if (assist) clientRows.push({ label: "Door-through-door assist", amount: money(assist) });
    if (after) clientRows.push({ label: "Before 6am / after 8pm", amount: money(after) });
    if (a.wait) clientRows.push({ label: "First hour of wait time", amount: "included" });
    clientRows.push({ label: "Your fare", amount: money(total) });
    return { total: total, rows: rows, clientRows: clientRows, miles: totalMiles };
  }
  // convenience: pass one-way miles, get the total-miles figure back
  function totalMilesFor(oneWay, tripType) {
    return Number(oneWay || 0) * (tripType === "round" ? (C.ROUND_TRIP_MULTIPLIER || 2) : 1);
  }
  function serviceLabel(id) {
    var t = (C.SERVICE_TYPES || []).find(function (x) { return x.id === id; });
    return t ? t.label : "";
  }
  function vehicleName(v) { return v === "wav" ? "Wheelchair-accessible van" : v === "stretcher" ? "Stretcher / gurney vehicle" : v === "suv" ? "SUV" : "Sedan"; }
  function vehicleShort(v) { return v === "wav" ? "Wheelchair van" : v === "stretcher" ? "Stretcher" : v === "suv" ? "SUV" : "Sedan"; }

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

  // Only the owner ever sees database warnings. Customers and drivers
  // must never be shown setup or error messages.
  function dbBanner() {
    if (!DBERROR || !ME || ME.role !== "owner") return '';
    return '<div style="background:oklch(0.96 0.03 85);padding:12px 32px;font:500 14px/1.5 Figtree,sans-serif;color:oklch(0.42 0.09 75);text-align:center;">' + esc(DBERROR) + '</div>';
  }

  function header(root) {
    var acct;
    if (!ME) acct = '<a href="' + root + 'account/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Sign in</a>';
    else {
      var links = '<a href="' + root + 'profile/" title="Your profile" style="display:flex;align-items:center;gap:8px;color:oklch(0.42 0.02 250);font:600 15px/1 Figtree,sans-serif;">' + avatar(ME, 32) + '</a>' +
        '<a href="' + root + 'my-rides/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">My rides</a>';
      if (ME.role === "driver") links += '<a href="' + root + 'driver/rides/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Driver console</a>';
      if (ME.role === "owner") links += '<a href="' + root + 'owner/dashboard/" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.42 0.02 250);">Dispatch console</a>';
      acct = links;
    }
    return dbBanner() + '<header style="position:sticky;top:0;z-index:20;background:rgba(255,255,255,0.92);backdrop-filter:blur(10px);border-bottom:1px solid oklch(0.93 0.01 250);">' +
      '<div class="hdr-inner" style="max-width:1180px;margin:0 auto;padding:0 32px;height:76px;display:flex;align-items:center;justify-content:space-between;gap:24px;">' +
      '<a href="' + root + '" class="hdr-logo" style="color:inherit;">' + logo(38) + '</a>' +
      '<nav class="hdr-nav" style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;">' + acct +
      '<a href="tel:' + C.PHONE_TEL + '" class="hdr-phone" style="font:600 15px/1 Figtree,sans-serif;color:oklch(0.34 0.02 250);">' + C.PHONE_DISPLAY + '</a>' +
      '<a href="' + root + 'book/" style="padding:12px 20px;border-radius:8px;background:oklch(0.62 0.115 237);color:#fff;font:600 15px/1 Figtree,sans-serif;">Book now</a>' +
      (ME ? '<button onclick="ISV.auth.signOutTo(\'' + root + '\')" style="cursor:pointer;padding:11px 16px;border-radius:8px;background:none;border:1px solid oklch(0.88 0.02 250);color:oklch(0.42 0.02 250);font:600 14px/1 Figtree,sans-serif;">Sign out</button>' : '') +
      '</nav></div></header>';
  }

  function footer(root) {
    return '<footer style="border-top:1px solid oklch(0.93 0.01 250);background:#fff;">' +
      '<div style="max-width:1180px;margin:0 auto;padding:48px 32px;display:flex;align-items:flex-start;justify-content:space-between;gap:40px;flex-wrap:wrap;">' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '<div style="display:flex;align-items:center;gap:11px;">' + logo(28) + '</div>' +
      '<span style="font:400 13.5px/1.6 Figtree,sans-serif;color:oklch(0.55 0.015 250);max-width:280px;">Family and veteran owned LLC, serving the ' + C.AREA + ' since ' + C.EST_YEAR + '.</span>' +
      '</div>' +
      '<div style="display:flex;gap:56px;flex-wrap:wrap;">' +
      '<div style="display:flex;flex-direction:column;gap:10px;"><span style="font:600 11px/1 Barlow,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:oklch(0.62 0.11 237);">Contact</span>' +
      '<a href="tel:' + C.PHONE_TEL + '" style="font:500 15px/1 Figtree,sans-serif;">' + C.PHONE_DISPLAY + '</a>' +
      '<a href="mailto:' + C.EMAIL + '" style="font:500 15px/1 Figtree,sans-serif;">' + C.EMAIL + '</a></div>' +
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
      '<a href="' + root + '" class="side-logo" style="padding:0 8px;color:inherit;">' + logo(26, true, sub) + '</a>' +
      (DBERROR ? '<div style="background:oklch(0.50 0.15 25);color:#fff;padding:10px 12px;border-radius:9px;font:500 12.5px/1.5 Figtree,sans-serif;">' + esc(DBERROR) + '</div>' : '') +
      '<div class="side-nav" style="display:flex;flex-direction:column;gap:4px;">' + nav + '</div>' +
      '<div class="side-acct" style="margin-top:auto;display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:12px;background:rgba(255,255,255,0.07);">' +
      '<a href="' + root + 'profile/" class="side-who" style="display:flex;align-items:center;gap:10px;text-decoration:none;">' + avatar(me, 34) +
      '<span style="display:flex;flex-direction:column;gap:2px;"><span style="font:600 14px/1.3 Figtree,sans-serif;color:#fff;">' + (me.name || "") + '</span>' +
      '<span style="font:400 12px/1.3 Figtree,sans-serif;color:rgba(255,255,255,0.55);">' + (me.role === "owner" ? "Owner" : me.role === "driver" ? "Driver" : "") + '</span></span></a>' +
      '<button onclick="ISV.auth.signOutTo(\'' + root + '\')" style="cursor:pointer;background:none;padding:9px;border:1px solid rgba(255,255,255,0.28);border-radius:8px;font:600 13px/1 Figtree,sans-serif;color:#fff;text-align:center;">Sign out</button>' +
      '</div></aside>';
  }

  function avatar(person, size) {
    var s = size || 36;
    var name = (person && person.name) || "";
    var initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase() || "?";
    var photo = person && person.photo;
    if (photo) {
      return '<img src="' + photo + '" alt="" style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:oklch(0.93 0.01 250);">';
    }
    return '<div style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;flex:0 0 auto;background:oklch(0.90 0.04 237);color:oklch(0.40 0.09 240);display:flex;align-items:center;justify-content:center;font:700 ' + Math.round(s * 0.38) + 'px/1 Figtree,sans-serif;">' + esc(initials) + '</div>';
  }

  function pill(status) {
    var map = {
      "Pending":   ["oklch(0.96 0.04 60)",    "oklch(0.48 0.13 45)"],
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
  function mapsUrl(addr) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr); }
  function mapLink(addr, style) {
    if (!addr) return "";
    return '<a href="' + mapsUrl(addr) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="' + (style || "") + '">' + esc(addr) + '</a>';
  }
  var LEG_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function legLabel(b) {
    if (!b || !b.leg) return "";
    if (b.leg === "A") return "A Leg";
    if (b.leg === "B") return "B Leg";
    return b.leg + " Leg";
  }
  function legDescription(b) {
    if (!b || !b.leg) return "";
    if (b.leg === "A") return "A Leg - to the appointment";
    if (b.leg === "B") return "B Leg - return home";
    return b.leg + " Leg - onward stop";
  }
  function tripLine(b) {
    var leg = legLabel(b);
    return (leg ? leg + " · " : "") + vehicleShort(b.vehicle) + " · " + (b.miles || 0) + " mi";
  }

  window.ISV = {
    root: "", ready: ready, auth: AUTH, book: BOOK,
    onChange: function (fn) { changeHandlers.push(fn); },
    bootstrapped: function () { return BOOTSTRAPPED; },
    paymentsReady: function () { return PAYMENTS_OK; },
    driverQueryOk: function () { return DRIVER_QUERY_OK; },
    // Straight HTTPS fetch, bypassing the realtime channel. Used by the
    // driver console's "Reload from server" button and as a safety net.
    fetchMyRides: function () {
      if (!ME) return Promise.resolve({ error: "not signed in", rides: [] });
      return Promise.all([
        restWhere("bookings", "driverEmail", ME.email).catch(function (e) { return { __err: friendly(e) }; }),
        restWhere("bookings", "userEmail", ME.email).catch(function () { return []; })
      ]).then(function (res) {
        if (res[0] && res[0].__err) return { error: res[0].__err, rides: [] };
        var seen = {}, out = [];
        res[0].concat(Array.isArray(res[1]) ? res[1] : []).forEach(function (b) {
          b.id = b.id || b.__docId;
          if (!seen[b.id]) { seen[b.id] = 1; out.push(b); }
        });
        BOOKINGS = out;
        fireChange();
        return { error: null, rides: out };
      });
    },
    dbError: function () { return DBERROR; },
    sendEmail: sendEmail, notifyNewBooking: notifyNewBooking, notifyAccepted: notifyAccepted, notifyDeclined: notifyDeclined,
    rideBlurb: rideBlurb, telHref: telHref, smsHref: smsHref, driverRideText: driverRideText, serviceLabel: serviceLabel,
    money: money, fare: fare, totalMilesFor: totalMilesFor, vehicleName: vehicleName, vehicleShort: vehicleShort,
    logo: logo, header: header, footer: footer, sidebar: sidebar, pill: pill, avatar: avatar,
    fmtDate: fmtDate, fmtTime: fmtTime, esc: esc, tripLine: tripLine, mapsUrl: mapsUrl, mapLink: mapLink,
    legLabel: legLabel, legDescription: legDescription, LEG_LETTERS: LEG_LETTERS
  };
})();
