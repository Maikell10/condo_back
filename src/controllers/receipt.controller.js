const db = require("../db");

const getPendingReceipts = async (req, res) => {
    const ownerId = req.user.id;
    try {
        const query = `
            SELECT 
                r.id, 
                DATE_FORMAT(r.issue_date, '%b %Y') AS fecha,
                r.amount AS monto,
                r.paid AS paid,
                r.status,                     -- 🔥 AGREGASTE EL ESTADO PARA EL FRONT
                (r.amount - r.paid) AS deuda, 
                (r.amount - r.paid) AS saldo  
            FROM receipts r
            INNER JOIN apartments a ON r.apartment_id = a.id
            WHERE a.owner_id = ? 
              AND r.status IN ('PENDING', 'PARTIAL') -- 🔥 AHORA TRAE LOS PARCIALES TAMBIÉN
            ORDER BY r.issue_date ASC
        `;

        const [receipts] = await db.query(query, [ownerId]);
        res.json({ message: "Recibos obtenidos", data: receipts });
    } catch (error) {
        console.error("Error en getPendingReceipts:", error);
        res.status(500).json({ message: "Error en el servidor" });
    }
};

module.exports = {
    getPendingReceipts,
};
