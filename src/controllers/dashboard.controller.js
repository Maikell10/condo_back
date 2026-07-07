const db = require("../db");

const getDashboardStats = async (req, res) => {
    const { buildingId } = req.params;
    const { complexId } = req.query; // Solo viene si buildingId es 'ALL'

    try {
        // --- NUEVA ESTRUCTURA DEL OBJETO STATS ---
        let stats = {
            building: { name: "", code: "" },
            kpis: {
                totalApartments: 0,
                occupied: 0,
                delinquent: 0,
                monthIncome: 0,
                prevMonthIncome: 0, // <-- Ahora enviamos el previo
            },
            featured: [],
            collection: {
                // <-- Estructura doble para el Frontend
                current: {
                    period: "",
                    expected: 0,
                    collected: 0,
                    missing: 0,
                    rate: 0,
                },
                previous: {
                    period: "",
                    expected: 0,
                    collected: 0,
                    missing: 0,
                    rate: 0,
                },
            },
        };

        // --- Configuración de Fechas (Actual y Anterior) ---
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        // Lógica para retroceder un mes (y un año si estamos en Enero)
        const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

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

        stats.collection.current.period = `${monthNames[currentMonth - 1]} ${currentYear}`;
        stats.collection.previous.period = `${monthNames[prevMonth - 1]} ${prevYear}`;

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

        // --- 2. Ingresos en CAJA REAL (Pagos Aprobados) ---
        const incomeQuery = `
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM payments 
            WHERE status = 'APPROVED' 
            AND MONTH(payment_date) = ? AND YEAR(payment_date) = ?
            AND apartment_id IN (SELECT id FROM apartments WHERE ${filterApartments})
        `;
        // Ejecutamos para ambos meses
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

        const currIncomeVal = parseFloat(currentIncome[0].total);
        const prevIncomeVal = parseFloat(prevIncome[0].total);

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

        // --- 4. Eficiencia de Recaudación: FACTURADO vs COBRADO ---
        // Buscamos cuánto se facturó (Expected) en los respectivos meses
        const expectedQuery = `
            SELECT COALESCE(SUM(r.amount), 0) as expected
            FROM receipts r
            JOIN apartments a ON r.apartment_id = a.id
            JOIN buildings b ON a.building_id = b.id
            WHERE ${filterReceiptsBuilding} AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?
        `;
        const [currExpectedData] = await db.query(expectedQuery, [
            ...queryParams,
            currentMonth,
            currentYear,
        ]);
        const [prevExpectedData] = await db.query(expectedQuery, [
            ...queryParams,
            prevMonth,
            prevYear,
        ]);

        const currExpected = parseFloat(currExpectedData[0].expected);
        const prevExpected = parseFloat(prevExpectedData[0].expected);

        // --- 5. Construcción Final del Objeto ---
        stats.kpis.totalApartments = kpiApts[0].total;
        stats.kpis.occupied = kpiApts[0].occupied;
        stats.kpis.delinquent = kpiApts[0].delinquent;
        stats.kpis.monthIncome = currIncomeVal;
        stats.kpis.prevMonthIncome = prevIncomeVal; // Alimenta el texto pequeño
        stats.featured = featured;

        // Cálculos del Mes Actual
        stats.collection.current.expected = currExpected;
        stats.collection.current.collected = currIncomeVal; // Usamos el flujo de caja real
        stats.collection.current.missing =
            currExpected > currIncomeVal ? currExpected - currIncomeVal : 0;
        stats.collection.current.rate =
            currExpected > 0
                ? Math.round((currIncomeVal / currExpected) * 100)
                : currIncomeVal > 0
                  ? 100
                  : 0;

        // Cálculos del Mes Anterior
        stats.collection.previous.expected = prevExpected;
        stats.collection.previous.collected = prevIncomeVal; // Usamos el flujo de caja real
        stats.collection.previous.missing =
            prevExpected > prevIncomeVal ? prevExpected - prevIncomeVal : 0;
        stats.collection.previous.rate =
            prevExpected > 0
                ? Math.round((prevIncomeVal / prevExpected) * 100)
                : prevIncomeVal > 0
                  ? 100
                  : 0;

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
