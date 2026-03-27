const db = require("../db");

const getPendingReceipts = async (req, res) => {
    const ownerId = req.user.id;
    try {
        const query = `
            SELECT 
                r.id, 
                DATE_FORMAT(r.issue_date, '%b %Y') AS fecha,
                r.amount AS monto,
                r.paid AS paid,       -- 🔥 ANTES DECÍA: 0 AS pagado
                (r.amount - r.paid) AS deuda, -- 🔥 AHORA SE CALCULA EN SQL
                (r.amount - r.paid) AS saldo  -- 🔥 EL SALDO REAL RESTANTE
            FROM receipts r
            INNER JOIN apartments a ON r.apartment_id = a.id
            WHERE a.owner_id = ? AND r.status = 'PENDING'
            ORDER BY r.issue_date ASC
        `;

        const [receipts] = await db.query(query, [ownerId]);
        res.json({ message: "Recibos obtenidos", data: receipts });
    } catch (error) {
        res.status(500).json({ message: "Error en el servidor" });
    }
};

module.exports = {
    getPendingReceipts,
};
