const db = require("../db");

const generateMonthlyBilling = async (req, res) => {
    const { buildingId, month, year } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. VALIDACIÓN: ¿Ya está cerrado?
        const [check] = await connection.query(
            "SELECT id FROM billing_periods WHERE building_id = ? AND month = ? AND year = ?",
            [buildingId, month, year],
        );
        if (check.length > 0)
            throw new Error(
                "Este periodo ya ha sido facturado y está cerrado.",
            );

        // 2. SUMAR GASTOS VARIABLES (Facturas del mes)
        const [variableSum] = await connection.query(
            `
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM building_expenses 
            WHERE building_id = ? AND MONTH(expense_date) = ? AND YEAR(expense_date) = ?
        `,
            [buildingId, month, year],
        );

        const paddedMonth = month.toString().padStart(2, "0");
        const firstDayOfMonth = `${year}-${paddedMonth}-01`;
        // 3. VALIDAR Y SUMAR CONTRATOS (Gastos fijos activos)
        const [fixedSum] = await connection.query(
            `
            SELECT COALESCE(SUM(monthly_amount), 0) as total 
            FROM contracts 
            WHERE building_id = ? 
            AND is_active = 1 
            -- Simplificamos: el contrato debe haber iniciado antes o durante el mes
            -- y terminar después o durante el mes
            AND start_date <= LAST_DAY(?)
            AND end_date >= ?
        `,
            [buildingId, firstDayOfMonth, firstDayOfMonth],
        );

        const totalToDistribute =
            Number(variableSum[0].total) + Number(fixedSum[0].total);

        if (totalToDistribute <= 0) {
            throw new Error(
                "No hay gastos registrados (facturas o contratos) para cerrar este mes.",
            );
        }

        // 4. GENERAR RECIBOS POR ALÍCUOTA
        const [apartments] = await connection.query(
            "SELECT id, alicuota FROM apartments WHERE building_id = ?",
            [buildingId],
        );

        const issueDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const description = `Condominio ${month}/${year}`;

        for (const apt of apartments) {
            const aptAmount = totalToDistribute * Number(apt.alicuota);

            await connection.query(
                `
                INSERT INTO receipts (apartment_id, issue_date, amount, paid, status, description)
                VALUES (?, ?, ?, 0, 'PENDING', ?)
            `,
                [apt.id, issueDate, aptAmount, description],
            );
        }

        // 5. REGISTRAR EL CIERRE
        await connection.query(
            "INSERT INTO billing_periods (building_id, month, year) VALUES (?, ?, ?)",
            [buildingId, month, year],
        );

        await connection.commit();
        res.json({
            message: `¡Cierre exitoso! Se generaron ${apartments.length} recibos por un total de $${totalToDistribute.toFixed(2)}.`,
        });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

// Obtener gastos del mes en curso para el edificio
const getBuildingExpenses = async (req, res) => {
    // buildingId puede ser un número (ej. 1) o el texto 'ALL'
    const { buildingId } = req.params;
    const { month, year, complexId } = req.query;

    try {
        if (buildingId === "ALL") {
            // 1. VISTA GLOBAL: Traer todos los gastos de todos los edificios del conjunto
            const expensesQuery = `
                SELECT be.id, ec.code, ec.description as provider, be.amount, 
                       DATE_FORMAT(be.expense_date, '%Y-%m-%d') as date, 'Variable' as type,
                       b.name as buildingName
                FROM building_expenses be
                JOIN expense_concepts ec ON be.concept_id = ec.id
                JOIN buildings b ON be.building_id = b.id
                WHERE b.complex_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
                ORDER BY be.expense_date DESC
            `;
            const [expenses] = await db.query(expensesQuery, [
                complexId,
                month,
                year,
            ]);

            // 2. LÓGICA DE ESTADO GLOBAL: ¿Están todos los edificios cerrados?
            const [totalBuildings] = await db.query(
                "SELECT COUNT(id) as count FROM buildings WHERE complex_id = ? AND status = 'ACTIVE'",
                [complexId],
            );

            const [closedPeriods] = await db.query(
                `SELECT COUNT(bp.id) as count 
                 FROM billing_periods bp
                 JOIN buildings b ON bp.building_id = b.id
                 WHERE b.complex_id = ? AND bp.month = ? AND bp.year = ? AND bp.status = 'CLOSED'`,
                [complexId, month, year],
            );

            // Si la cantidad de edificios del conjunto es igual a la cantidad de periodos cerrados de ese mes
            const isFullyClosed =
                totalBuildings[0].count > 0 &&
                totalBuildings[0].count === closedPeriods[0].count;

            res.json({
                data: expenses,
                status: isFullyClosed ? "CLOSED" : "OPEN",
                canClose: false, // Se mantiene en FALSE para obligar a facturar por edificio individualmente
            });
        } else {
            // 2. VISTA INDIVIDUAL: Lógica original para un solo edificio
            const expensesQuery = `
                SELECT be.id, ec.code, ec.description as provider, be.amount, 
                       DATE_FORMAT(be.expense_date, '%Y-%m-%d') as date, 'Variable' as type
                FROM building_expenses be
                JOIN expense_concepts ec ON be.concept_id = ec.id
                WHERE be.building_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
                ORDER BY be.expense_date DESC
            `;
            const [expenses] = await db.query(expensesQuery, [
                buildingId,
                month,
                year,
            ]);

            // Verificar si este periodo ya está cerrado en la nueva tabla
            const [period] = await db.query(
                "SELECT status FROM billing_periods WHERE building_id = ? AND month = ? AND year = ?",
                [buildingId, month, year],
            );

            // Verificar si existen meses anteriores sin cerrar
            const [olderPending] = await db.query(
                `
                SELECT 1 FROM building_expenses 
                WHERE building_id = ? AND expense_date < STR_TO_DATE(?, '%Y-%m-%d')
                AND CONCAT(MONTH(expense_date), '-', YEAR(expense_date)) NOT IN (
                    SELECT CONCAT(month, '-', year) FROM billing_periods WHERE building_id = ?
                ) LIMIT 1
                `,
                [buildingId, `${year}-${month}-01`, buildingId],
            );

            res.json({
                data: expenses,
                status: period.length > 0 ? "CLOSED" : "OPEN",
                canClose: period.length === 0 && olderPending.length === 0,
            });
        }
    } catch (error) {
        console.error("Error en getBuildingExpenses:", error);
        res.status(500).json({
            message: "Error al obtener datos de facturación",
        });
    }
};

// Registrar un nuevo gasto manual
const addExpense = async (req, res) => {
    // Recibimos buildingId que puede ser un número (Ej: 1) o el texto 'ALL'
    const { buildingId, complexId, conceptId, amount, expenseDate } = req.body;

    try {
        if (buildingId === "ALL") {
            // 1. Buscamos cuántos edificios tiene este conjunto
            const [buildings] = await db.query(
                "SELECT id FROM buildings WHERE complex_id = ? AND status = 'ACTIVE'",
                [complexId],
            );

            if (buildings.length === 0) {
                return res.status(400).json({
                    message: "No hay edificios registrados en este conjunto.",
                });
            }

            // 2. Prorrateamos (dividimos) el monto total entre la cantidad de edificios
            const dividedAmount = (
                parseFloat(amount) / buildings.length
            ).toFixed(2);

            // 3. Insertamos el gasto para CADA edificio automáticamente
            for (let b of buildings) {
                await db.query(
                    "INSERT INTO building_expenses (building_id, concept_id, amount, expense_date) VALUES (?, ?, ?, ?)",
                    [b.id, conceptId, dividedAmount, expenseDate],
                );
            }

            res.status(201).json({
                message: `Factura global registrada. Se dividió en $${dividedAmount} para cada edificio.`,
            });
        } else {
            // Lógica normal para un solo edificio
            await db.query(
                "INSERT INTO building_expenses (building_id, concept_id, amount, expense_date) VALUES (?, ?, ?, ?)",
                [buildingId, conceptId, amount, expenseDate],
            );
            res.status(201).json({
                message: "Gasto registrado para el edificio seleccionado.",
            });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error al registrar el gasto" });
    }
};

// Borrar un gasto solo si el mes sigue abierto
const deleteExpense = async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Obtener la fecha del gasto para saber a qué mes pertenece
        const [expense] = await db.query(
            "SELECT building_id, MONTH(expense_date) as month, YEAR(expense_date) as year FROM building_expenses WHERE id = ?",
            [id],
        );

        if (expense.length === 0)
            return res.status(404).json({ message: "Gasto no encontrado" });

        const { building_id, month, year } = expense[0];

        // 2. Verificar si ese mes ya está cerrado
        const [period] = await db.query(
            "SELECT id FROM billing_periods WHERE building_id = ? AND month = ? AND year = ?",
            [building_id, month, year],
        );

        if (period.length > 0) {
            return res.status(403).json({
                message:
                    "No se puede eliminar un gasto de un periodo ya cerrado.",
            });
        }

        // 3. Proceder al borrado
        await db.query("DELETE FROM building_expenses WHERE id = ?", [id]);
        res.json({ message: "Gasto eliminado correctamente" });
    } catch (error) {
        res.status(500).json({
            message: "Error al intentar eliminar el gasto",
        });
    }
};

// Obtener historial de cierres del edificio
const getClosedPeriods = async (req, res) => {
    const { buildingId } = req.params;
    try {
        const [periods] = await db.query(
            "SELECT id, month, year, DATE_FORMAT(closed_at, '%d/%m/%Y %H:%i') as closed_at FROM billing_periods WHERE building_id = ? ORDER BY year DESC, month DESC",
            [buildingId],
        );
        res.json({ data: periods });
    } catch (error) {
        res.status(500).json({ message: "Error al obtener historial" });
    }
};

const getMonthlyReport = async (req, res) => {
    const { buildingId } = req.params;
    const { month, year } = req.query; // Asegúrate de que estos vengan en la URL

    try {
        // 1. Padeamos el mes para evitar errores (ej: '2' -> '02')
        const paddedMonth = month.toString().padStart(2, "0");
        const targetDate = `${year}-${paddedMonth}-01`;

        // 2. Obtener Gastos Variables (Los $355.00 que ya te salen bien)
        const [variableExpenses] = await db.query(
            `
            SELECT ec.code, ec.description, be.amount, DATE_FORMAT(be.expense_date, '%d/%m/%Y') as date
            FROM building_expenses be
            JOIN expense_concepts ec ON be.concept_id = ec.id
            WHERE be.building_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
        `,
            [buildingId, month, year],
        );

        // 3. Obtener Gastos Fijos (Aquí es donde daba 0)
        // Usamos una comparación de fechas simplificada
        const [fixedExpenses] = await db.query(
            `
            SELECT provider, service as description, monthly_amount as amount
            FROM contracts
            WHERE building_id = ? 
            AND is_active = 1
            AND start_date <= LAST_DAY(?)
            AND end_date >= ?
        `,
            [buildingId, targetDate, targetDate],
        );

        // 4. Totales
        const totalVariable = variableExpenses.reduce(
            (acc, curr) => acc + Number(curr.amount),
            0,
        );
        const totalFixed = fixedExpenses.reduce(
            (acc, curr) => acc + Number(curr.amount),
            0,
        );

        // 🔥 CRÍTICO: Enviamos month y year de vuelta para que el modal no salga con "/"
        res.json({
            month,
            year,
            variableExpenses,
            fixedExpenses,
            summary: {
                totalVariable,
                totalFixed,
                totalAmount: totalVariable + totalFixed,
            },
        });
    } catch (error) {
        res.status(500).json({ message: "Error al generar el reporte" });
    }
};

//Estado de cuenta del building_admin
const getStatements = async (req, res) => {
    // buildingId puede ser un número (ej. 1) o 'ALL'
    const { buildingId } = req.params;
    const { complexId } = req.query;

    try {
        let query = "";
        let params = [];

        if (buildingId === "ALL") {
            // VISTA GLOBAL: Recibos de todos los edificios del conjunto
            query = `
                SELECT r.id, DATE_FORMAT(r.issue_date, '%Y-%m-%d') as issueDate, 
                       r.amount, r.paid, (r.amount - r.paid) as balance, 
                       r.status, r.description,
                       a.number as apartment, u.name as ownerName, b.name as buildingName,
                       a.id as apartmentId, a.building_id as buildingId
                FROM receipts r
                JOIN apartments a ON r.apartment_id = a.id
                JOIN buildings b ON a.building_id = b.id
                LEFT JOIN users u ON a.owner_id = u.id
                WHERE b.complex_id = ?
                ORDER BY r.issue_date DESC, b.name ASC, a.number ASC
            `;
            params = [complexId];
        } else {
            // VISTA INDIVIDUAL: Recibos de un solo edificio
            query = `
                SELECT r.id, DATE_FORMAT(r.issue_date, '%Y-%m-%d') as issueDate, 
                       r.amount, r.paid, (r.amount - r.paid) as balance, 
                       r.status, r.description,
                       a.number as apartment, u.name as ownerName
                FROM receipts r
                JOIN apartments a ON r.apartment_id = a.id
                LEFT JOIN users u ON a.owner_id = u.id
                WHERE a.building_id = ?
                ORDER BY r.issue_date DESC, a.number ASC
            `;
            params = [buildingId];
        }

        const [receipts] = await db.query(query, params);
        res.json({ data: receipts });
    } catch (error) {
        console.error("Error en getStatements:", error);
        res.status(500).json({
            message: "Error al obtener los estados de cuenta",
        });
    }
};

const registerAdminPayment = async (req, res) => {
    const {
        receiptId,
        apartmentId,
        bankAccountId,
        operationType,
        reference,
        amount,
        paymentDate,
    } = req.body;

    try {
        // 1. Obtener la información actual del recibo para matemáticas precisas
        const [receipts] = await db.query(
            "SELECT amount, paid FROM receipts WHERE id = ?",
            [receiptId],
        );
        if (receipts.length === 0)
            return res.status(404).json({ message: "Recibo no encontrado" });

        const receipt = receipts[0];

        // Sumamos lo que ya tenía pagado + el nuevo abono
        const newPaid = parseFloat(receipt.paid) + parseFloat(amount);

        // Si lo pagado alcanza o supera el total, se marca PAID, sino PARTIAL
        const newStatus =
            newPaid >= parseFloat(receipt.amount) ? "PAID" : "PARTIAL";

        // 2. Insertar el pago en la tabla payments (entra directamente como APPROVED)
        await db.query(
            `INSERT INTO payments (apartment_id, bank_account, operation_type, reference, amount, payment_date, status)
             VALUES (?, ?, ?, ?, ?, ?, 'APPROVED')`,
            [
                apartmentId,
                bankAccountId,
                operationType,
                reference,
                amount,
                paymentDate,
            ],
        );

        // 3. Actualizar los montos y el estado en el recibo
        await db.query(
            `UPDATE receipts SET paid = ?, status = ? WHERE id = ?`,
            [newPaid, newStatus, receiptId],
        );

        res.json({
            message: "Pago registrado exitosamente y recibo actualizado.",
        });
    } catch (error) {
        console.error("Error en registerAdminPayment:", error);
        res.status(500).json({ message: "Error al procesar el pago." });
    }
};

const getPendingSummary = async (req, res) => {
    const { buildingId } = req.params;

    try {
        const query = `
            SELECT 
                a.number as unit, 
                u.name as owner, 
                COUNT(r.id) as receipts, 
                SUM(r.amount - r.paid) as debt
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            JOIN receipts r ON a.id = r.apartment_id
            WHERE a.building_id = ? AND r.status IN ('PENDING', 'PARTIAL')
            GROUP BY a.id
            HAVING debt > 0
            ORDER BY a.number ASC
        `;
        const [summary] = await db.query(query, [buildingId]);
        res.json({ data: summary });
    } catch (error) {
        console.error("Error en getPendingSummary:", error);
        res.status(500).json({
            message: "Error al obtener el listado de morosidad",
        });
    }
};

const getPendingDetailed = async (req, res) => {
    const { buildingId } = req.params;

    try {
        const query = `
            SELECT 
                a.number as unit, 
                u.name as owner, 
                DATE_FORMAT(r.issue_date, '%m-%Y') as period,
                r.description,
                (r.amount - r.paid) as debt
            FROM receipts r
            JOIN apartments a ON r.apartment_id = a.id
            LEFT JOIN users u ON a.owner_id = u.id
            WHERE a.building_id = ? AND r.status IN ('PENDING', 'PARTIAL')
            ORDER BY a.number ASC, r.issue_date ASC
        `;

        const [details] = await db.query(query, [buildingId]);
        res.json({ data: details });
    } catch (error) {
        console.error("Error en getPendingDetailed:", error);
        res.status(500).json({
            message: "Error al obtener el detalle de morosidad",
        });
    }
};

// 1. Obtiene solo los meses y años que realmente tienen gastos registrados
const getAvailableExpensePeriods = async (req, res) => {
    const { buildingId } = req.params;

    try {
        const query = `
            SELECT DISTINCT 
                MONTH(expense_date) as month, 
                YEAR(expense_date) as year
            FROM building_expenses
            WHERE building_id = ?
            ORDER BY year DESC, month DESC
        `;
        const [periods] = await db.query(query, [buildingId]);
        res.json({ data: periods });
    } catch (error) {
        console.error("Error en getAvailableExpensePeriods:", error);
        res.status(500).json({
            message: "Error al obtener periodos disponibles",
        });
    }
};

// 2. Obtiene el detalle de los gastos para un mes y año específico
const getExpensesByPeriod = async (req, res) => {
    const { buildingId } = req.params;
    const { month, year } = req.query;

    try {
        const query = `
            SELECT 
                ec.code, 
                ec.description, 
                be.amount
            FROM building_expenses be
            JOIN expense_concepts ec ON be.concept_id = ec.id
            WHERE be.building_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
            ORDER BY ec.code ASC
        `;
        const [expenses] = await db.query(query, [buildingId, month, year]);
        res.json({ data: expenses });
    } catch (error) {
        console.error("Error en getExpensesByPeriod:", error);
        res.status(500).json({
            message: "Error al obtener los gastos del periodo",
        });
    }
};

// 1. Obtiene los recibos (periodos y apartamentos) que le pertenecen al propietario logueado
const getOwnerReceiptPeriods = async (req, res) => {
    const ownerId = req.user.id;
    try {
        const query = `
            SELECT DISTINCT 
                a.id as apartmentId, 
                a.number as apartmentNumber, 
                a.alicuota,
                MONTH(r.issue_date) as month, 
                YEAR(r.issue_date) as year
            FROM receipts r
            JOIN apartments a ON r.apartment_id = a.id
            WHERE a.owner_id = ?
            ORDER BY year DESC, month DESC, a.number ASC
        `;
        const [periods] = await db.query(query, [ownerId]);
        res.json({ data: periods });
    } catch (error) {
        console.error("Error en getOwnerReceiptPeriods:", error);
        res.status(500).json({
            message: "Error al obtener periodos del recibo",
        });
    }
};

// 2. Obtiene el detalle de gastos del edificio para calcular el recibo
const getOwnerReceiptDetail = async (req, res) => {
    const { apartmentId } = req.params;
    const { month, year } = req.query;

    try {
        // 1. Obtener datos del apartamento para la matemática
        const [aptData] = await db.query(
            "SELECT building_id, alicuota, number FROM apartments WHERE id = ?",
            [apartmentId],
        );
        if (aptData.length === 0)
            return res
                .status(404)
                .json({ message: "Apartamento no encontrado" });

        const alicuota = parseFloat(aptData[0].alicuota);
        const buildingId = aptData[0].building_id;

        // 2. Obtener gastos del edificio en ese periodo
        const query = `
            SELECT 
                ec.code, 
                ec.description, 
                be.amount as totalAmount
            FROM building_expenses be
            JOIN expense_concepts ec ON be.concept_id = ec.id
            WHERE be.building_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
            ORDER BY ec.code ASC
        `;
        const [expenses] = await db.query(query, [buildingId, month, year]);

        res.json({
            data: expenses,
            alicuota: alicuota,
            apartmentNumber: aptData[0].number,
        });
    } catch (error) {
        console.error("Error en getOwnerReceiptDetail:", error);
        res.status(500).json({
            message: "Error al obtener el detalle del recibo",
        });
    }
};

const getPaidReceipts = async (req, res) => {
    const ownerId = req.user.id;

    try {
        const query = `
            SELECT 
                r.id, 
                CONCAT(MONTH(r.issue_date), '-', YEAR(r.issue_date)) as period,
                r.paid as amount,
                r.status,
                r.issue_date,
                a.number as apartmentNumber,
                b.name as buildingName
            FROM receipts r
            JOIN apartments a ON r.apartment_id = a.id
            JOIN buildings b ON a.building_id = b.id
            WHERE a.owner_id = ? AND r.status = 'PAID'
            ORDER BY r.issue_date DESC
        `;
        const [receipts] = await db.query(query, [ownerId]);
        res.json({ data: receipts });
    } catch (error) {
        console.error("Error en getPaidReceipts:", error);
        res.status(500).json({
            message: "Error al obtener historial de pagos",
        });
    }
};

const createExpenseConcept = async (req, res) => {
    const { description } = req.body;

    if (!description) {
        return res
            .status(400)
            .json({ message: "La descripción del concepto es obligatoria." });
    }

    try {
        // 1. Obtener el código máximo numérico actual (convirtiendo el string a número)
        const [maxRes] = await db.query(
            "SELECT MAX(CAST(code AS UNSIGNED)) as maxCode FROM expense_concepts",
        );
        const currentMax = maxRes[0].maxCode || 0;

        // 2. Incrementar e inicializar el formato con ceros a la izquierda (3 dígitos)
        const nextCodeNum = currentMax + 1;
        const nextCode = String(nextCodeNum).padStart(3, "0");

        // 3. Insertar el nuevo concepto en el catálogo
        const [insertRes] = await db.query(
            "INSERT INTO expense_concepts (code, description) VALUES (?, ?)",
            [nextCode, description.trim()],
        );

        res.status(201).json({
            message: "Concepto de gasto creado en el catálogo.",
            data: {
                id: insertRes.insertId,
                code: nextCode,
                description: description.trim(),
            },
        });
    } catch (error) {
        console.error("Error al crear concepto de gasto:", error);
        res.status(500).json({
            message: "Error interno al guardar en el catálogo.",
        });
    }
};

module.exports = {
    getBuildingExpenses,
    addExpense,
    generateMonthlyBilling,
    getClosedPeriods,
    deleteExpense,
    getMonthlyReport,
    getStatements,
    registerAdminPayment,
    getPendingSummary,
    getPendingDetailed,
    getAvailableExpensePeriods,
    getExpensesByPeriod,
    getOwnerReceiptPeriods,
    getOwnerReceiptDetail,
    getPaidReceipts,
    createExpenseConcept,
};
