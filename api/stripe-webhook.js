// Source de vérité des abonnements : seul Stripe (signature vérifiée) peut passer un compte en Pro.
const { env, send, db, verifyStripeSignature, readRaw } = require("./_lib/common");

const ACTIVE = new Set(["active", "trialing"]);

async function applySubscription(sub) {
  const userId = sub.metadata && sub.metadata.user_id;
  const filter = userId ? "id=eq." + userId : "stripe_customer_id=eq." + sub.customer;
  await db("profiles?" + filter, {
    method: "PATCH",
    body: JSON.stringify({
      plan: ACTIVE.has(sub.status) ? "pro" : "free",
      subscription_status: sub.status,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      stripe_customer_id: sub.customer,
    }),
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Méthode non autorisée" });
  const raw = await readRaw(req);
  if (!verifyStripeSignature(raw, req.headers["stripe-signature"], env("STRIPE_WEBHOOK_SECRET"))) {
    return send(res, 400, { error: "Signature invalide" });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return send(res, 400, { error: "JSON invalide" }); }
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscription(event.data.object);
        if (event.data.object.metadata && event.data.object.metadata.user_id) {
          const name = event.type.endsWith("deleted") ? "subscription_canceled" : "subscription_" + event.data.object.status;
          await db("events", { method: "POST", body: JSON.stringify({ user_id: event.data.object.metadata.user_id, name }) });
        }
        break;
      default:
        break; // événements ignorés
    }
    return send(res, 200, { received: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Traitement échoué" }); // Stripe réessaiera automatiquement
  }
};

module.exports.config = { api: { bodyParser: false } };
