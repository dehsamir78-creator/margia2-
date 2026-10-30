// Margia : agrégation des ventes et préparation de l'e-reporting (calcul 100 % local, rien n'est envoyé).
(function (root) {
  // Lecteur CSV (guillemets, virgules ou points-virgules, retours à la ligne dans les champs)
  function parseCSV(text) {
    text = String(text || "").replace(/^﻿/, "");
    var first = text.split(/\r?\n/)[0] || "";
    var sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    var rows = [], row = [], f = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows[0].map(function (h) { return h.trim(); });
    return { headers: headers, rows: rows.slice(1).map(function (r) {
      var o = {}; headers.forEach(function (h, k) { o[h] = (r[k] || "").trim(); }); return o;
    }) };
  }

  function num(v) {
    if (v == null) return 0;
    var s = String(v).replace(/[€$£\s ]/g, "");
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  // Dates : ISO, "2026-10-03 14:22:01 +0200", "03/10/2026", "Oct 3, 2026"
  function parseDate(v) {
    v = String(v || "").trim();
    if (!v) return null;
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = v.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
    if (m) { var y = +m[3]; if (y < 100) y += 2000; return { y: y, m: +m[2], d: +m[1] }; }
    var d = new Date(v);
    return isNaN(d) ? null : { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }

  var COUNTRY = { france: "FR", "united states": "US", belgique: "BE", belgium: "BE", suisse: "CH", switzerland: "CH",
    luxembourg: "LU", canada: "CA", allemagne: "DE", germany: "DE", espagne: "ES", spain: "ES", italie: "IT", italy: "IT",
    "royaume-uni": "GB", "united kingdom": "GB", monaco: "MC" };
  function iso(c) {
    c = String(c || "").trim();
    if (!c) return "";
    if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
    return COUNTRY[c.toLowerCase()] || c.toUpperCase().slice(0, 2);
  }

  // Détection du format
  function detect(headers) {
    var h = headers.map(function (x) { return x.toLowerCase(); });
    var has = function (k) { return h.indexOf(k.toLowerCase()) >= 0; };
    if (has("Financial Status") && has("Total") && has("Name")) return "shopify";
    if (has("Sale Date") && has("Order Value")) return "etsy";
    return "generic";
  }

  function pick(headers, names) {
    for (var i = 0; i < names.length; i++) {
      var f = headers.find(function (h) { return h.toLowerCase() === names[i].toLowerCase(); });
      if (f) return f;
    }
    return "";
  }

  // Devine les colonnes d'un export inconnu (Amazon, eBay, tableur perso)
  function guessMapping(headers) {
    var find = function (re) { return headers.find(function (h) { return re.test(h); }) || ""; };
    return {
      date: find(/date|paid|pay[ée]|encaiss/i),
      amount: find(/^total|montant|amount|order.?value|prix.?total|grand.?total/i),
      country: find(/pays|country/i),
      company: find(/soci[ée]t[ée]|company|entreprise|raison/i),
      id: find(/commande|order.?(id|number)|^name$|n[°o]/i)
    };
  }

  // Normalise chaque fichier en transactions {id, date, ttc, tax, country, b2b, src}
  function normalize(parsed, mapping) {
    var headers = parsed.headers, fmt = detect(headers), out = [], skipped = 0;
    if (fmt === "shopify") {
      var seen = {};
      parsed.rows.forEach(function (r) {
        var id = r["Name"];
        if (!id || seen[id] || !r["Financial Status"]) return; // lignes d'articles supplémentaires
        seen[id] = 1;
        var st = r["Financial Status"].toLowerCase();
        if (!/paid|refunded|partially/.test(st) || st === "voided") { skipped++; return; }
        var total = num(r["Total"]), refunded = num(r["Refunded Amount"]);
        var net = Math.max(0, total - refunded);
        if (net <= 0) { skipped++; return; }
        var tax = total > 0 ? num(r["Taxes"]) * net / total : 0;
        var d = parseDate(r["Paid at"] || r["Created at"]);
        if (!d) { skipped++; return; }
        out.push({ id: id, date: d, ttc: net, tax: tax, country: iso(r["Shipping Country"] || r["Billing Country"]),
          b2b: !!(r["Billing Company"] || "").trim(), src: "Shopify" });
      });
    } else if (fmt === "etsy") {
      parsed.rows.forEach(function (r) {
        var d = parseDate(r["Sale Date"]), net = num(r["Order Net"] || r["Order Value"]) || num(r["Order Value"]);
        var ttc = num(r["Order Total"]) || num(r["Order Value"]) + num(r["Shipping"]) - num(r["Discount Amount"]);
        if (!d || ttc <= 0) { skipped++; return; }
        out.push({ id: r["Order ID"], date: d, ttc: ttc, tax: num(r["Sales Tax"]), country: iso(r["Ship Country"]), b2b: false, src: "Etsy" });
      });
    } else {
      var m = mapping || guessMapping(headers);
      if (!m.date || !m.amount) return { fmt: fmt, tx: [], skipped: parsed.rows.length, needMapping: true, mapping: m };
      parsed.rows.forEach(function (r) {
        var d = parseDate(r[m.date]), ttc = num(r[m.amount]);
        if (!d || ttc <= 0) { skipped++; return; }
        out.push({ id: m.id ? r[m.id] : "", date: d, ttc: ttc, tax: 0, country: iso(m.country ? r[m.country] : "FR") || "FR",
          b2b: !!(m.company && (r[m.company] || "").trim()), src: "Import" });
      });
      return { fmt: fmt, tx: out, skipped: skipped, mapping: m };
    }
    return { fmt: fmt, tx: out, skipped: skipped };
  }

  function r2(x) { return Math.round(x * 100) / 100; }
  function monthKey(d) { return d.y + "-" + String(d.m).padStart(2, "0"); }
  function biKey(d) { var b = Math.ceil(d.m / 2); return d.y + "-B" + b; }
  function biRange(key) {
    var y = +key.slice(0, 4), b = +key.slice(6), m1 = 2 * b - 1, m2 = 2 * b;
    var last = new Date(y, m2, 0).getDate();
    return { start: y + "-" + String(m1).padStart(2, "0") + "-01", end: y + "-" + String(m2).padStart(2, "0") + "-" + last };
  }

  // Classement réglementaire
  //  - B2C France  → e-reporting (montant agrégé + nombre de transactions)
  //  - Étranger    → e-reporting (transactions internationales)
  //  - B2B France  → facture électronique via plateforme agréée (pas d'e-reporting)
  function aggregate(tx, opts) {
    opts = opts || {};
    var bucket = opts.bimonthly === false ? monthKey : biKey, map = {};
    tx.forEach(function (t) {
      var k = bucket(t.date);
      var p = map[k] || (map[k] = { period: k, b2c: { n: 0, ttc: 0, tax: 0 }, intl: { n: 0, ttc: 0, tax: 0 }, b2b: { n: 0, ttc: 0, tax: 0 }, months: {} });
      var cat = t.b2b && (t.country === "FR" || !t.country) ? "b2b" : t.country && t.country !== "FR" ? "intl" : "b2c";
      p[cat].n++; p[cat].ttc += t.ttc; p[cat].tax += t.tax;
      var mk = monthKey(t.date); p.months[mk] = (p.months[mk] || 0) + t.ttc - t.tax;
    });
    return Object.keys(map).sort().reverse().map(function (k) {
      var p = map[k];
      ["b2c", "intl", "b2b"].forEach(function (c) { p[c].ttc = r2(p[c].ttc); p[c].tax = r2(p[c].tax); p[c].ht = r2(p[c].ttc - p[c].tax); });
      Object.keys(p.months).forEach(function (m) { p.months[m] = r2(p.months[m]); });
      p.totalHt = r2(p.b2c.ht + p.intl.ht + p.b2b.ht);
      return p;
    });
  }

  // Brouillon neutre à remettre à la plateforme agréée (qui le convertit au format officiel)
  function draft(period, siren, franchise) {
    var rg = biRange(period.period), lines = [];
    var add = function (scope, c) {
      if (!c.n) return;
      lines.push({ perimetre: scope, categorie: "LIVRAISON_BIENS", devise: "EUR", nombre_transactions: c.n,
        montant_ht: c.ht, montant_tva: franchise ? 0 : c.tax, montant_ttc: c.ttc,
        mention: franchise ? "TVA non applicable, art. 293 B du CGI" : undefined });
    };
    add("B2C_FRANCE", period.b2c);
    add("INTERNATIONAL", period.intl);
    return { type: "E_REPORTING_TRANSACTIONS", statut: "BROUILLON", siren: siren || null, regime_tva: franchise ? "FRANCHISE_EN_BASE" : "REEL",
      periode: { debut: rg.start, fin: rg.end }, lignes: lines, genere_par: "Margia", genere_le: new Date().toISOString() };
  }

  function toCSV(periods) {
    var h = ["Periode", "Perimetre", "Transactions", "Montant HT", "TVA", "Montant TTC"], out = [h.join(";")];
    var f = function (x) { return String(x).replace(".", ","); };
    periods.forEach(function (p) {
      [["B2C France", p.b2c], ["International", p.intl], ["B2B France (facture electronique)", p.b2b]].forEach(function (l) {
        if (l[1].n) out.push([p.period, l[0], l[1].n, f(l[1].ht), f(l[1].tax), f(l[1].ttc)].join(";"));
      });
    });
    return out.join("\n");
  }

  var api = { parseCSV: parseCSV, normalize: normalize, aggregate: aggregate, draft: draft, toCSV: toCSV,
    guessMapping: guessMapping, detect: detect, biRange: biRange, num: num, parseDate: parseDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MargiaER = api;
})(this);
