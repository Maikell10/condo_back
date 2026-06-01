const db = require("../db");

const getDashboardStats = async (req, res) => {
    const { buildingId } = req.params;
    const { complexId } = req.query; // Solo si buildingId es 'ALL'

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

        let queryParams = [];
        let buildingFilter = "";
        let aptFilter = "";

        if (buildingId === "ALL") {
            stats.building = { name: "Conjunto Residencial", code: "GLOBAL" };
            buildingFilter = "b.complex_id = ?";
            aptFilter = "IN (SELECT id FROM buildings WHERE complex_id = ?)";
            queryParams = [complexId];
        } else {
            const [bInfo] = await db.query(
                "SELECT name, code FROM buildings WHERE id = ?",
                [buildingId],
            );
            stats.building = bInfo[0] || { name: "Edificio", code: "N/A" };
            buildingFilter = "b.id = ?";
            aptFilter = "= ?";
            queryParams = [buildingId];
        }

        // --- 1. Obtener KPIs Básicos ---
        // (Asumiendo que tienes consultas similares, aquí te dejo la idea de las sumatorias)
        // stats.kpis.totalApartments = ...
        // stats.kpis.monthIncome = ... (Suma de payments APPROVED del mes)

        // --- 2. EFICIENCIA DE RECAUDACIÓN (El corazón de tu solicitud) ---
        const collectionQuery = `
            SELECT 
                COALESCE(SUM(r.amount), 0) as expected,
                COALESCE(SUM(r.paid), 0) as collected
            FROM receipts r
            JOIN apartments a ON r.apartment_id = a.id
            JOIN buildings b ON a.building_id = b.id
            WHERE ${buildingFilter} AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?
        `;
        const [collData] = await db.query(collectionQuery, [
            ...queryParams,
            currentMonth,
            currentYear,
        ]);

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
        res.status(500).json({ message: "Error al cargar el dashboard" });
    }
};

module.exports = { getDashboardStats };
