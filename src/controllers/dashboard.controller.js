const db = require("../db");

const getDashboardStats = async (req, res) => {
    const { buildingId } = req.params;
    const { complexId } = req.query; // Solo viene si buildingId es 'ALL'

    try {
        let stats = {
            building: { name: "", code: "" },
            kpis: {
                totalApartments: 0,
                occupied: 0,
                delinquent: 0,
                monthIncome: 0,
            },
            featured: [],
            collection: {
                period: "",
                expected: 0,
                collected: 0,
                missing: 0,
                rate: 0,
            },
        };

        // --- Configuración de Fecha para Eficiencia de Recaudación ---
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();
        const monthNames = [
            "Enero",
            "Febrero",
            "Marzo",
            "Abril",
            "Mayo",
            "Junio",
            "Julio",
            "Agosto",
            "Septiembre",
            "Octubre",
            "Noviembre",
            "Diciembre",
        ];
        stats.collection.period = `${monthNames[currentMonth - 1]} ${currentYear}`;

        // --- Variables Dinámicas (Vista Global vs Individual) ---
        let filterApartments = "";
        let filterReceiptsBuilding = "";
        let queryParams = [];

        if (buildingId === "ALL") {
            stats.building = { name: "Resumen del Conjunto", code: "GLOBAL" };
            filterApartments =
                "building_id IN (SELECT id FROM buildings WHERE complex_id = ?)";
            filterReceiptsBuilding = "b.complex_id = ?";
            queryParams = [complexId];
        } else {
            const [bInfo] = await db.query(
                "SELECT name, code FROM buildings WHERE id = ?",
                [buildingId],
            );
            stats.building = bInfo[0] || { name: "Edificio", code: "N/A" };
            filterApartments = "building_id = ?";
            filterReceiptsBuilding = "b.id = ?";
            queryParams = [buildingId];
        }

        // --- 1. KPIs de Apartamentos ---
        const [kpiApts] = await db.query(
            `
            SELECT 
                COUNT(*) as total,
                COUNT(owner_id) as occupied,
                (SELECT COUNT(DISTINCT apartment_id) FROM receipts 
                 WHERE status IN ('PENDING', 'PARTIAL') AND apartment_id IN (SELECT id FROM apartments WHERE ${filterApartments})) as delinquent
            FROM apartments WHERE ${filterApartments}
        `,
            [...queryParams, ...queryParams],
        );

        // --- 2. Ingresos del mes (De pagos aprobados) ---
        const [income] = await db.query(
            `
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM payments 
            WHERE status = 'APPROVED' 
            AND MONTH(payment_date) = MONTH(CURRENT_DATE())
            AND YEAR(payment_date) = YEAR(CURRENT_DATE())
            AND apartment_id IN (SELECT id FROM apartments WHERE ${filterApartments})
        `,
            [...queryParams],
        );

        // --- 3. Apartamentos con mayor deuda (Featured) ---
        const [featured] = await db.query(
            `
            SELECT a.number, u.name as ownerName, 
                   COALESCE(SUM(r.amount - r.paid), 0) as balance
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            JOIN receipts r ON a.id = r.apartment_id
            WHERE a.${filterApartments} AND r.status IN ('PENDING', 'PARTIAL')
            GROUP BY a.id
            ORDER BY balance DESC LIMIT 4
        `,
            [...queryParams],
        );

        // --- 4. Eficiencia de Recaudación (Módulo Nuevo) ---
        const collectionQuery = `
            SELECT 
                COALESCE(SUM(r.amount), 0) as expected,
                COALESCE(SUM(r.paid), 0) as collected
            FROM receipts r
            JOIN apartments a ON r.apartment_id = a.id
            JOIN buildings b ON a.building_id = b.id
            WHERE ${filterReceiptsBuilding} AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?
        `;
        const [collData] = await db.query(collectionQuery, [
            ...queryParams,
            currentMonth,
            currentYear,
        ]);

        // --- Mapeo de resultados al objeto final ---
        stats.kpis.totalApartments = kpiApts[0].total;
        stats.kpis.occupied = kpiApts[0].occupied;
        stats.kpis.delinquent = kpiApts[0].delinquent;
        stats.kpis.monthIncome = income[0].total;
        stats.featured = featured;

        const expected = parseFloat(collData[0].expected);
        const collected = parseFloat(collData[0].collected);
        stats.collection.expected = expected;
        stats.collection.collected = collected;
        stats.collection.missing =
            expected > collected ? expected - collected : 0;
        stats.collection.rate =
            expected > 0 ? Math.round((collected / expected) * 100) : 0;

        res.json(stats);
    } catch (error) {
        console.error("Error en getDashboardStats:", error);
        res.status(500).json({ message: "Error al cargar estadísticas" });
    }
};

const getOwnerDashboard = async (req, res) => {
    const ownerId = req.user.id; // Asumiendo que el middleware de auth inyecta el user
    try {
        // 1. Obtener datos del apartamento y propietario
        const [aptData] = await db.query(
            `
            SELECT a.id, a.number, b.name as buildingName, a.alicuota
            FROM apartments a
            JOIN buildings b ON a.building_id = b.id
            WHERE a.owner_id = ?
            LIMIT 1`,
            [ownerId],
        );

        if (aptData.length === 0)
            return res
                .status(404)
                .json({ message: "No tienes apartamentos asignados" });
        const apartment = aptData[0];

        // 2. Calcular Estado Financiero (Deuda actual)
        const [receipts] = await db.query(
            `
            SELECT COALESCE(SUM(amount - paid), 0) as currentDebt, COUNT(*) as pendingCount
            FROM receipts 
            WHERE apartment_id = ? AND status IN ('PENDING', 'PARTIAL')`,
            [apartment.id],
        );

        // 3. Último Pago Verificado
        const [lastPayment] = await db.query(
            `
            SELECT amount, DATE_FORMAT(payment_date, '%d %b %Y') as date, bank_account
            FROM payments 
            WHERE apartment_id = ? AND status = 'APPROVED'
            ORDER BY payment_date DESC LIMIT 1`,
            [apartment.id],
        );

        res.json({
            owner: {
                name: req.user.name,
                building: apartment.buildingName,
                unit: apartment.number,
                aliquot: parseFloat(apartment.alicuota) * 100,
            },
            financialStatus: {
                currentDebt: receipts[0].currentDebt,
                status: receipts[0].currentDebt > 0 ? "DEBT" : "UP_TO_DATE",
                pendingReceipts: receipts[0].pendingCount,
            },
            lastPayment: lastPayment[0] || {
                amount: 0,
                date: "N/A",
                method: "N/A",
            },
        });
    } catch (error) {
        res.status(500).json({ message: "Error al cargar dashboard" });
    }
};

module.exports = { getDashboardStats, getOwnerDashboard };
