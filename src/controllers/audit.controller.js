const db = require("../db");

const getAuditLogs = async (req, res) => {
    const { user, action, module, date } = req.query;
    let params = [];
    let whereConditions = [];

    // Construcción dinámica de la consulta
    if (user) {
        whereConditions.push("(u.name LIKE ? OR u.email LIKE ?)");
        params.push(`%${user}%`, `%${user}%`);
    }
    if (action) {
        whereConditions.push("a.action = ?");
        params.push(action);
    }
    if (module) {
        whereConditions.push("a.module = ?");
        params.push(module);
    }
    if (date) {
        whereConditions.push("DATE(a.created_at) = ?");
        params.push(date);
    }

    const whereClause =
        whereConditions.length > 0
            ? `WHERE ${whereConditions.join(" AND ")}`
            : "";

    try {
        const query = `
            SELECT 
                a.id, a.action, a.module, a.payload, a.ip_address,
                DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') as timestamp,
                u.name as userName, u.email as userEmail, u.role
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            ${whereClause}
            ORDER BY a.created_at DESC
            LIMIT 100
        `;
        const [logs] = await db.query(query, params);
        res.json({ data: logs });
    } catch (error) {
        res.status(500).json({ message: "Error al consultar logs" });
    }
};

module.exports = { getAuditLogs };
