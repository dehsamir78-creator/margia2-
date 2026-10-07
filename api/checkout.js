// Crée une session de paiement Stripe pour l'abonnement Pro.
const { billingReady, send, getUser, db, stripe, origin } = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Méthode non autorisée" });
  if (!billingReady()) return send(res, 503, { error: "Le paiement n'est pas encore ouvert." });
  try {
    const user = await getUser(req);
    if (!user || !user.id) return send(res, 401, { error: "Connecte-toi pour t'abonner." });
    const rows = await db("profiles?select=plan,stripe_customer_id&id=eq." + user.id);
    const p = rows && rows[0];
    if (p && p.plan === "pro") return send(res, 409, { error: "Tu es déjà abonné au plan Pro." });

    let customer = p && p.stripe_customer_id;
    if (!customer) {
      const c = await stripe("customers", { email: user.email, metadata: { user_id: user.id } });
      customer = c.id;
      await db("profiles?id=eq." + user.id, { method: "PATCH", body: JSON.stringify({ stripe_customer_id: customer }) });
    }
    const base = origin(req);
    const session = await stripe("checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: { 0: { price: process.env.STRIPE_PRICE_ID, quantity: 1 } },
      allow_promotion_codes: "true",
      locale: "fr",
      subscription_data: { metadata: { user_id: user.id } },
      success_url: base + "/app?abonnement=ok",
      cancel_url: base + "/tarifs?abonnement=annule",
    });
    return send(res, 200, { url: session.url });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Le paiement n'a pas pu démarrer. Réessaie dans un instant." });
  }
};
