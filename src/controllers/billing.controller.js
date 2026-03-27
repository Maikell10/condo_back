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
    const { buildingId } = req.params;
    const { month, year } = req.query;

    try {
        // 1. Consultar los gastos
        const expensesQuery = `
            SELECT be.id, ec.code, ec.description as provider, be.amount, 
                   DATE_FORMAT(be.expense_date, '%Y-%m-%d') as date, 'Variable' as type
            FROM building_expenses be
            JOIN expense_concepts ec ON be.concept_id = ec.id
            WHERE be.building_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
        `;
        const [expenses] = await db.query(expensesQuery, [
            buildingId,
            month,
            year,
        ]);

        // 2. Verificar si este periodo ya está cerrado en la nueva tabla
        const [period] = await db.query(
            "SELECT status FROM billing_periods WHERE building_id = ? AND month = ? AND year = ?",
            [buildingId, month, year],
        );

        // 3. Verificar si existen meses anteriores sin cerrar (Lógica de "El más antiguo")
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
            canClose: period.length === 0 && olderPending.length === 0, // Solo si es el más viejo
        });
    } catch (error) {
        res.status(500).json({ message: "Error al obtener datos" });
    }
};

// Registrar un nuevo gasto manual
const addExpense = async (req, res) => {
    const { buildingId, conceptId, amount, expenseDate } = req.body;
    try {
        await db.query(
            "INSERT INTO building_expenses (building_id, concept_id, amount, expense_date) VALUES (?, ?, ?, ?)",
            [buildingId, conceptId, amount, expenseDate],
        );
        res.status(201).json({ message: "Gasto registrado correctamente" });
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

module.exports = {
    getBuildingExpenses,
    addExpense,
    generateMonthlyBilling,
    getClosedPeriods,
    deleteExpense,
    getMonthlyReport,
};
