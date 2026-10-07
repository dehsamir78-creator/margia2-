const { billingReady, send } = require("./_lib/common");
module.exports = (req, res) => send(res, 200, { billing: billingReady() });
