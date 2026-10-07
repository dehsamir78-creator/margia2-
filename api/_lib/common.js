// Utilitaires serveur partagés. Les secrets viennent UNIQUEMENT des variables d'environnement Vercel.
const crypto = require("crypto");

const env = (k) => process.env[k] || "";
const billingReady = () =>
  !!(env("STRIPE_SECRET_KEY") && env("STRIPE_PRICE_ID") && env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Vérifie le jeton de session Supabase envoyé par le navigateur et renvoie l'utilisateur.
async function getUser(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const r = await fetch(env("SUPABASE_URL") + "/auth/v1/user", {
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + token },
  });
  return r.ok ? r.json() : null;
}

// Appels Supabase avec la clé service (contourne les règles d'accès : réservé au serveur).
async function db(path, init = {}) {
  const r = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("DB " + r.status + " " + t);
  return t ? JSON.parse(t) : null;
}

// Appel à l'API Stripe sans SDK (formulaire encodé).
function encode(obj, prefix) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") out.push(encode(v, key));
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.filter(Boolean).join("&");
}
async function stripe(path, params, method = "POST") {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + env("STRIPE_SECRET_KEY"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : encode(params || {}),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Stripe " + r.status + " " + (j.error && j.error.message));
  return j;
}

// Vérification de signature des webhooks Stripe (schéma v1, tolérance 5 min).
function verifyStripeSignature(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = parts.t;
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + raw).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function origin(req) {
  return env("SITE_URL") || "https://" + req.headers.host;
}

module.exports = { env, billingReady, send, getUser, db, stripe, verifyStripeSignature, readRaw, origin };
