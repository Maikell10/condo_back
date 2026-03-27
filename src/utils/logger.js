const db = require("../db");

const auditLog = async (userId, action, module, payload = null, req = null) => {
    try {
        const query = `
            INSERT INTO audit_logs (user_id, action, module, payload, ip_address)
            VALUES (?, ?, ?, ?, ?)
        `;
        const ip = req
            ? req.headers["x-forwarded-for"] || req.socket.remoteAddress
            : null;
        await db.query(query, [
            userId,
            action,
            module,
            JSON.stringify(payload),
            ip,
        ]);
    } catch (error) {
        console.error("Error al guardar log de auditoría:", error);
    }
};

//await auditLog(req.user.id, 'CLOSE_MONTH', 'INVOICES', { month, year }, req);

module.exports = { auditLog };
