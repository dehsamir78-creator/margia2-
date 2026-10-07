const { billingReady, webhookReady, send } = require("./_lib/common");
// billing : session de paiement via l'API Stripe ; link : lien de paiement Stripe + webhook prêt à activer le Pro.
module.exports = (req, res) => send(res, 200, { billing: billingReady(), link: webhookReady(), portal: billingReady() });
