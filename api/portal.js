// Ouvre l'espace client Stripe : factures, carte, changement ou annulation d'abonnement.
const { billingReady, send, getUser, db, stripe, origin } = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Méthode non autorisée" });
  if (!billingReady()) return send(res, 503, { error: "La facturation n'est pas encore ouverte." });
  try {
    const user = await getUser(req);
    if (!user || !user.id) return send(res, 401, { error: "Connecte-toi d'abord." });
    const rows = await db("profiles?select=stripe_customer_id&id=eq." + user.id);
    const customer = rows && rows[0] && rows[0].stripe_customer_id;
    if (!customer) return send(res, 404, { error: "Aucun abonnement trouvé pour ce compte." });
    const s = await stripe("billing_portal/sessions", { customer, return_url: origin(req) + "/app" });
    return send(res, 200, { url: s.url });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "L'espace de facturation n'a pas pu s'ouvrir." });
  }
};
