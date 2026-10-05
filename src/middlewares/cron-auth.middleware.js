/**
 * Vercel Cron: si CRON_SECRET está en env, exige
 * Authorization: Bearer <CRON_SECRET> (lo envía Vercel automáticamente)
 * o header X-Cron-Secret para pruebas manuales.
 */
const assertCronAuthorized = (req, res, next) => {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
        return next();
    }

    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";
    const custom = req.headers["x-cron-secret"] || "";

    if (bearer === expected || custom === expected) {
        return next();
    }

    return res.status(401).json({
        success: false,
        message: "Cron no autorizado",
    });
};

module.exports = { assertCronAuthorized };
