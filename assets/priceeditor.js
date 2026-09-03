(function () {
  var SHARE = (window.CONFIG && window.CONFIG.DRIVER_SHARE) || 0.6;

  function num(v) {
    var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function fixed(v) { return num(v).toFixed(2); }
  function filled(v) { return v !== null && v !== undefined && String(v).trim() !== "" && !isNaN(Number(v)); }
  function cash(v) { return "$" + num(v).toFixed(2); }
  function autoPayFor(fareAmount) { return +(num(fareAmount) * SHARE).toFixed(2); }

  function field(id, label, value, placeholder) {
    return '<div style="display:flex;flex-direction:column;gap:7px;">' +
      '<label class="lbl" for="' + id + '">' + label + '</label>' +
      '<div style="position:relative;">' +
      '<span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);font:600 15px/1 Figtree,sans-serif;color:oklch(0.58 0.015 250);pointer-events:none;">$</span>' +
      '<input id="' + id + '" class="inp" type="number" min="0" step="0.01" inputmode="decimal" ' +
      'value="' + (value === null || value === undefined ? "" : value) + '" ' +
      'placeholder="' + (placeholder || "") + '" style="padding-left:26px;">' +
      '</div></div>';
  }

  function mount(el, opts) {
    if (!el) return null;
    var o = opts || {};
    var seq = "pe" + Math.floor(100000 + Math.random() * 899999);
    var fareId = seq + "f", payId = seq + "p";
    var touched = false;

    el.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:14px;padding:18px 20px;border:1px solid oklch(0.88 0.03 237);border-radius:13px;background:oklch(0.985 0.012 237);">' +
        '<div style="display:flex;flex-direction:column;gap:3px;">' +
          '<span style="font:700 12px/1 Barlow,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:oklch(0.45 0.09 240);">' + (o.title || "Set the price") + '</span>' +
          '<span style="font:400 12.5px/1.5 Figtree,sans-serif;color:oklch(0.52 0.03 243);">' + (o.hint || "Whatever you type here is the price. Nothing is recalculated.") + '</span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          field(fareId, o.fareLabel || "Customer pays", o.fare === null || o.fare === undefined ? "" : fixed(o.fare), "0.00") +
          field(payId, o.payLabel || "Driver gets", filled(o.driverPay) ? fixed(o.driverPay) : "", fixed(autoPayFor(o.fare))) +
        '</div>' +
        '<span id="' + seq + 'n" style="font:500 12.5px/1.5 Figtree,sans-serif;color:oklch(0.50 0.02 250);"></span>' +
        (o.showSave
          ? '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
              '<button class="btn" id="' + seq + 's" style="padding:13px 22px;font-size:14px;">' + (o.saveLabel || "Save price") + '</button>' +
              '<button class="btn2" id="' + seq + 'r" style="padding:12px 16px;font-size:13.5px;">Reset driver pay</button>' +
              '<span id="' + seq + 'm" style="font:500 13px/1.4 Figtree,sans-serif;"></span>' +
            '</div>'
          : '') +
      '</div>';

    var fareEl = document.getElementById(fareId);
    var payEl = document.getElementById(payId);
    var noteEl = document.getElementById(seq + "n");
    var msgEl = document.getElementById(seq + "m");

    function values() {
      return {
        fare: +num(fareEl.value).toFixed(2),
        driverPay: filled(payEl.value) ? +num(payEl.value).toFixed(2) : null
      };
    }

    function paint() {
      var v = values();
      var pay = v.driverPay === null ? autoPayFor(v.fare) : v.driverPay;
      payEl.placeholder = autoPayFor(v.fare).toFixed(2);
      var keeps = +(v.fare - pay).toFixed(2);
      noteEl.innerHTML =
        'Driver sees <b>' + cash(pay) + '</b>' +
        (v.driverPay === null ? ' <span style="color:oklch(0.58 0.015 250);">(standard ' + Math.round(SHARE * 100) + '% share)</span>' : ' <span style="color:oklch(0.45 0.10 240);">(you set this)</span>') +
        ' &nbsp;·&nbsp; company keeps <b style="color:' + (keeps < 0 ? "oklch(0.50 0.15 25)" : "oklch(0.30 0.02 250)") + ';">' + cash(keeps) + '</b>';
    }

    function changed() {
      touched = true;
      paint();
      if (o.onChange) o.onChange(values());
    }

    fareEl.addEventListener("input", changed);
    payEl.addEventListener("input", changed);
    paint();

    if (o.showSave) {
      document.getElementById(seq + "r").onclick = function () {
        payEl.value = "";
        changed();
      };
      var saveBtn = document.getElementById(seq + "s");
      saveBtn.onclick = function () {
        var v = values();
        if (v.fare <= 0 && !confirm("Save this ride with a $0.00 fare?")) return;
        if (v.driverPay !== null && v.driverPay > v.fare &&
            !confirm("Driver pay (" + cash(v.driverPay) + ") is more than the fare (" + cash(v.fare) + "). Save anyway?")) return;
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        Promise.resolve(o.onSave ? o.onSave(v) : null).then(function () {
          msgEl.textContent = "Saved.";
          msgEl.style.color = "oklch(0.42 0.10 160)";
          setTimeout(function () { msgEl.textContent = ""; }, 2500);
        }).catch(function (e) {
          msgEl.textContent = "Couldn't save: " + e;
          msgEl.style.color = "oklch(0.50 0.15 25)";
        }).then(function () {
          saveBtn.disabled = false;
          saveBtn.textContent = o.saveLabel || "Save price";
        });
      };
    }

    return {
      read: values,
      isTouched: function () { return touched; },
      suggest: function (fareAmount) {
        if (touched) return;
        fareEl.value = fixed(fareAmount);
        paint();
      }
    };
  }

  window.ISVPrice = { mount: mount, autoPayFor: autoPayFor };
})();
