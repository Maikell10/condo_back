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
                prevMonthIncome: 0,
            },
            featured: [],
            collection: {
                current: {
                    period: "Cargando...",
                    expected: 0,
                    collected: 0,
                    missing: 0,
                    rate: 0,
                },
                previous: {
                    period: "Cargando...",
                    expected: 0,
                    collected: 0,
                    missing: 0,
                    rate: 0,
                },
            },
        };

        // --- Configuración de Fechas Calendario (Solo para Ingresos de Caja) ---
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();
        const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

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

        // --- 2. Ingresos en CAJA REAL (Pagos Aprobados por mes Calendario) ---
        const incomeQuery = `
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM payments 
            WHERE status = 'APPROVED' 
            AND MONTH(payment_date) = ? AND YEAR(payment_date) = ?
            AND apartment_id IN (SELECT id FROM apartments WHERE ${filterApartments})
        `;
        const [currentIncome] = await db.query(incomeQuery, [
            currentMonth,
            currentYear,
            ...queryParams,
        ]);
        const [prevIncome] = await db.query(incomeQuery, [
            prevMonth,
            prevYear,
            ...queryParams,
        ]);

        stats.kpis.monthIncome = parseFloat(currentIncome[0].total);
        stats.kpis.prevMonthIncome = parseFloat(prevIncome[0].total);

        // --- 3. Apartamentos con mayor deuda (Featured) ---
        const [featured] = await db.query(
            `
            SELECT a.number, u.name as ownerName, 
                b.name as buildingName,
                COALESCE(SUM(r.amount - r.paid), 0) as balance
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            JOIN receipts r ON a.id = r.apartment_id
            JOIN buildings b ON a.building_id = b.id
            WHERE a.${filterApartments} AND r.status IN ('PENDING', 'PARTIAL')
            GROUP BY a.id
            ORDER BY balance DESC LIMIT 4
            `,
            [...queryParams],
        );

        // --- 4. EFICIENCIA DE RECAUDACIÓN (Basado en los últimos 2 Periodos Emitidos) ---

        // A) Buscamos las últimas 2 descripciones facturadas ordenadas por fecha
        const [recentPeriods] = await db.query(
            `
            SELECT DISTINCT r.description, r.issue_date
            FROM receipts r
            JOIN apartments a ON r.apartment_id = a.id
            JOIN buildings b ON a.building_id = b.id
            WHERE ${filterReceiptsBuilding}
            ORDER BY r.issue_date DESC
            LIMIT 2
        `,
            [...queryParams],
        );

        // Seteamos valores por defecto en caso de que sea un edificio nuevo sin recibos
        stats.collection.current = {
            period: "Sin facturación",
            expected: 0,
            collected: 0,
            missing: 0,
            rate: 0,
        };
        stats.collection.previous = {
            period: "Sin facturación",
            expected: 0,
            collected: 0,
            missing: 0,
            rate: 0,
        };

        if (recentPeriods.length > 0) {
            // PERIODO ACTUAL (El último emitido, ej: "Condominio 6/2026")
            const p1 = recentPeriods[0];
            const [c1] = await db.query(
                `
                SELECT COALESCE(SUM(r.amount), 0) as expected, COALESCE(SUM(r.paid), 0) as collected
                FROM receipts r
                JOIN apartments a ON r.apartment_id = a.id
                JOIN buildings b ON a.building_id = b.id
                WHERE ${filterReceiptsBuilding} AND r.description = ?
            `,
                [...queryParams, p1.description],
            );

            const exp1 = parseFloat(c1[0].expected);
            const col1 = parseFloat(c1[0].collected);

            stats.collection.current.period = p1.description;
            stats.collection.current.expected = exp1;
            stats.collection.current.collected = col1;
            stats.collection.current.missing = exp1 > col1 ? exp1 - col1 : 0;
            stats.collection.current.rate =
                exp1 > 0 ? Math.round((col1 / exp1) * 100) : 0;

            // PERIODO ANTERIOR (El penúltimo emitido)
            if (recentPeriods.length > 1) {
                const p2 = recentPeriods[1];
                const [c2] = await db.query(
                    `
                    SELECT COALESCE(SUM(r.amount), 0) as expected, COALESCE(SUM(r.paid), 0) as collected
                    FROM receipts r
                    JOIN apartments a ON r.apartment_id = a.id
                    JOIN buildings b ON a.building_id = b.id
                    WHERE ${filterReceiptsBuilding} AND r.description = ?
                `,
                    [...queryParams, p2.description],
                );

                const exp2 = parseFloat(c2[0].expected);
                const col2 = parseFloat(c2[0].collected);

                stats.collection.previous.period = p2.description;
                stats.collection.previous.expected = exp2;
                stats.collection.previous.collected = col2;
                stats.collection.previous.missing =
                    exp2 > col2 ? exp2 - col2 : 0;
                stats.collection.previous.rate =
                    exp2 > 0 ? Math.round((col2 / exp2) * 100) : 0;
            }
        }

        // --- Mapeo final ---
        stats.kpis.totalApartments = kpiApts[0].total;
        stats.kpis.occupied = kpiApts[0].occupied;
        stats.kpis.delinquent = kpiApts[0].delinquent;
        stats.featured = featured;

        res.json(stats);
    } catch (error) {
        console.error("Error en getDashboardStats:", error);
        res.status(500).json({ message: "Error al cargar estadísticas" });
    }
};

module.exports = { getDashboardStats };

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
