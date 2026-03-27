const db = require("../db");

const getDashboardStats = async (req, res) => {
    const { buildingId } = req.params;
    try {
        // 1. Datos del Edificio
        const [building] = await db.query(
            "SELECT name, code FROM buildings WHERE id = ?",
            [buildingId],
        );

        // 2. KPIs de Apartamentos
        const [kpiApts] = await db.query(
            `
            SELECT 
                COUNT(*) as total,
                COUNT(owner_id) as occupied,
                (SELECT COUNT(DISTINCT apartment_id) FROM receipts 
                 WHERE status = 'PENDING' AND apartment_id IN (SELECT id FROM apartments WHERE building_id = ?)) as delinquent
            FROM apartments WHERE building_id = ?
        `,
            [buildingId, buildingId],
        );

        // 3. Ingresos del mes (Usando tu tabla 'payments' y status 'APPROVED')
        const [income] = await db.query(
            `
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM payments 
            WHERE status = 'APPROVED' 
            AND MONTH(payment_date) = MONTH(CURRENT_DATE())
            AND YEAR(payment_date) = YEAR(CURRENT_DATE())
            AND apartment_id IN (SELECT id FROM apartments WHERE building_id = ?)
        `,
            [buildingId],
        );

        // 4. Apartamentos con mayor deuda (Usando tu tabla 'receipts')
        const [featured] = await db.query(
            `
            SELECT a.number, u.name as ownerName, 
                   COALESCE(SUM(r.amount - r.paid), 0) as balance
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            JOIN receipts r ON a.id = r.apartment_id
            WHERE a.building_id = ? AND r.status = 'PENDING'
            GROUP BY a.id
            ORDER BY balance DESC LIMIT 4
        `,
            [buildingId],
        );

        res.json({
            building: building[0],
            kpis: {
                totalApartments: kpiApts[0].total,
                occupied: kpiApts[0].occupied,
                delinquent: kpiApts[0].delinquent,
                monthIncome: income[0].total,
            },
            featured,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al cargar estadísticas" });
    }
};

module.exports = { getDashboardStats };
