const db = require("../db");

const RESERVE_CONCEPT = "Fondo de Reserva";

const getSettingsAdminId = async (connOrDb, buildingId) => {
    const [rows] = await connOrDb.query(
        `SELECT b.admin_id, rc.admin_id AS complex_admin_id
         FROM buildings b
         LEFT JOIN residential_complexes rc ON b.complex_id = rc.id
         WHERE b.id = ?`,
        [buildingId],
    );
    if (!rows.length) return null;
    return rows[0].admin_id || rows[0].complex_admin_id || null;
};

const sumVariableExpenses = async (connOrDb, buildingId, month, year) => {
    const [variableSum] = await connOrDb.query(
        `
        SELECT COALESCE(SUM(amount), 0) as total 
        FROM building_expenses 
        WHERE building_id = ? AND MONTH(expense_date) = ? AND YEAR(expense_date) = ?
        AND concept_id NOT IN (SELECT id FROM expense_concepts WHERE description = ?)
    `,
        [buildingId, month, year, RESERVE_CONCEPT],
    );
    return Number(variableSum[0].total);
};

const sumFixedContracts = async (connOrDb, buildingId, month, year) => {
    const paddedMonth = month.toString().padStart(2, "0");
    const firstDayOfMonth = `${year}-${paddedMonth}-01`;
    const [fixedSum] = await connOrDb.query(
        `
        SELECT COALESCE(SUM(monthly_amount), 0) as total 
        FROM contracts 
        WHERE building_id = ? 
        AND is_active = 1 
        AND start_date <= LAST_DAY(?)
        AND end_date >= ?
    `,
        [buildingId, firstDayOfMonth, firstDayOfMonth],
    );
    return Number(fixedSum[0].total);
};

const getReserveFundConfig = async (connOrDb, buildingId) => {
    const adminId = await getSettingsAdminId(connOrDb, buildingId);
    if (!adminId) {
        return { hasReserveFund: false, reserveFundPercentage: 0 };
    }
    const [settings] = await connOrDb.query(
        "SELECT has_reserve_fund, reserve_fund_percentage FROM admin_settings WHERE admin_id = ?",
        [adminId],
    );
    if (!settings.length || !settings[0].has_reserve_fund) {
        return { hasReserveFund: false, reserveFundPercentage: 0 };
    }
    return {
        hasReserveFund: true,
        reserveFundPercentage: Number(settings[0].reserve_fund_percentage) || 0,
    };
};

const isPeriodClosed = async (connOrDb, buildingId, month, year) => {
    const [check] = await connOrDb.query(
        "SELECT id FROM billing_periods WHERE building_id = ? AND month = ? AND year = ?",
        [buildingId, month, year],
    );
    return check.length > 0;
};

const hasOlderUnclosedExpenses = async (connOrDb, buildingId, month, year) => {
    const [olderPending] = await connOrDb.query(
        `
        SELECT 1 FROM building_expenses 
        WHERE building_id = ? AND expense_date < STR_TO_DATE(?, '%Y-%m-%d')
        AND CONCAT(MONTH(expense_date), '-', YEAR(expense_date)) NOT IN (
            SELECT CONCAT(month, '-', year) FROM billing_periods WHERE building_id = ?
        ) LIMIT 1
        `,
        [buildingId, `${year}-${month}-01`, buildingId],
    );
    return olderPending.length > 0;
};

const listExpenseRows = async (connOrDb, buildingId, month, year) => {
    const [variableExpenses] = await connOrDb.query(
        `
        SELECT ec.code, ec.description, be.amount, DATE_FORMAT(be.expense_date, '%d/%m/%Y') as date
        FROM building_expenses be
        JOIN expense_concepts ec ON be.concept_id = ec.id
        WHERE be.building_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
        AND ec.description != ?
        ORDER BY be.expense_date ASC
    `,
        [buildingId, month, year, RESERVE_CONCEPT],
    );

    const paddedMonth = month.toString().padStart(2, "0");
    const targetDate = `${year}-${paddedMonth}-01`;
    const [fixedExpenses] = await connOrDb.query(
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

    return { variableExpenses, fixedExpenses };
};

const computeCloseTotals = async (connOrDb, buildingId, month, year) => {
    const subtotalExpenses =
        (await sumVariableExpenses(connOrDb, buildingId, month, year)) +
        (await sumFixedContracts(connOrDb, buildingId, month, year));

    const reserve = await getReserveFundConfig(connOrDb, buildingId);
    let reserveFundAmount = 0;
    if (reserve.hasReserveFund && reserve.reserveFundPercentage > 0) {
        reserveFundAmount =
            (subtotalExpenses * reserve.reserveFundPercentage) / 100;
    }
    const totalToDistribute = subtotalExpenses + reserveFundAmount;

    const [[aptRow]] = await connOrDb.query(
        "SELECT COUNT(*) AS c FROM apartments WHERE building_id = ?",
        [buildingId],
    );

    return {
        subtotalExpenses,
        hasReserveFund: reserve.hasReserveFund,
        reserveFundPercentage: reserve.reserveFundPercentage,
        reserveFundAmount,
        totalToDistribute,
        apartmentCount: Number(aptRow?.c || 0),
    };
};

const previewBuildingClose = async (buildingId, month, year, meta = {}) => {
    const [[building]] = await db.query(
        "SELECT id, name, code FROM buildings WHERE id = ?",
        [buildingId],
    );
    const buildingName = meta.name || building?.name || "Edificio";
    const buildingCode = meta.code || building?.code || "";

    const alreadyClosed = await isPeriodClosed(db, buildingId, month, year);
    const olderPending = await hasOlderUnclosedExpenses(
        db,
        buildingId,
        month,
        year,
    );

    const totals = await computeCloseTotals(db, buildingId, month, year);
    const { variableExpenses, fixedExpenses } = await listExpenseRows(
        db,
        buildingId,
        month,
        year,
    );

    let canClose = false;
    let blockReason = null;
    if (alreadyClosed) {
        blockReason = "Este periodo ya está cerrado.";
    } else if (olderPending) {
        blockReason = "Hay meses anteriores con gastos sin cerrar.";
    } else if (totals.subtotalExpenses <= 0) {
        blockReason = "No hay gastos ni contratos para este mes.";
    } else {
        canClose = true;
    }

    return {
        buildingId,
        buildingName,
        buildingCode,
        month,
        year,
        alreadyClosed,
        canClose,
        blockReason,
        variableExpenses,
        fixedExpenses,
        summary: {
            totalVariable: variableExpenses.reduce(
                (a, r) => a + Number(r.amount),
                0,
            ),
            totalFixed: fixedExpenses.reduce(
                (a, r) => a + Number(r.amount),
                0,
            ),
            subtotalExpenses: totals.subtotalExpenses,
            hasReserveFund: totals.hasReserveFund,
            reserveFundPercentage: totals.reserveFundPercentage,
            reserveFundAmount: totals.reserveFundAmount,
            totalAmount: totals.totalToDistribute,
            totalToDistribute: totals.totalToDistribute,
            apartmentCount: totals.apartmentCount,
        },
    };
};

const executeBuildingClose = async (connection, buildingId, month, year) => {
    const check = await isPeriodClosed(connection, buildingId, month, year);
    if (check) {
        throw new Error("Este periodo ya ha sido facturado y está cerrado.");
    }

    const subtotalExpenses =
        (await sumVariableExpenses(connection, buildingId, month, year)) +
        (await sumFixedContracts(connection, buildingId, month, year));

    if (subtotalExpenses <= 0) {
        throw new Error(
            "No hay gastos registrados (facturas o contratos) para cerrar este mes.",
        );
    }

    const olderPending = await hasOlderUnclosedExpenses(
        connection,
        buildingId,
        month,
        year,
    );
    if (olderPending) {
        throw new Error("Hay meses anteriores con gastos sin cerrar.");
    }

    let reserveFundAmount = 0;
    let totalToDistribute = subtotalExpenses;
    const reserve = await getReserveFundConfig(connection, buildingId);
    const paddedMonth = month.toString().padStart(2, "0");

    if (reserve.hasReserveFund && reserve.reserveFundPercentage > 0) {
        reserveFundAmount =
            (subtotalExpenses * reserve.reserveFundPercentage) / 100;
        totalToDistribute += reserveFundAmount;

        let [concept] = await connection.query(
            "SELECT id FROM expense_concepts WHERE description = ?",
            [RESERVE_CONCEPT],
        );
        let conceptId;
        if (concept.length === 0) {
            const [newConcept] = await connection.query(
                "INSERT INTO expense_concepts (code, description) VALUES ('RES_FUND', ?)",
                [RESERVE_CONCEPT],
            );
            conceptId = newConcept.insertId;
        } else {
            conceptId = concept[0].id;
        }

        const expenseDate = `${year}-${paddedMonth}-28`;
        await connection.query(
            `INSERT INTO building_expenses (building_id, concept_id, amount, expense_date) VALUES (?, ?, ?, ?)`,
            [buildingId, conceptId, reserveFundAmount, expenseDate],
        );
    }

    const [apartments] = await connection.query(
        "SELECT id, alicuota FROM apartments WHERE building_id = ?",
        [buildingId],
    );

    const issueDate = `${year}-${paddedMonth}-01`;
    const description = `Condominio ${month}/${year}`;

    for (const apt of apartments) {
        const aptAmount = totalToDistribute * Number(apt.alicuota);
        await connection.query(
            `INSERT INTO receipts (apartment_id, issue_date, amount, paid, status, description)
             VALUES (?, ?, ?, 0, 'PENDING', ?)`,
            [apt.id, issueDate, aptAmount, description],
        );
    }

    await connection.query(
        "INSERT INTO billing_periods (building_id, month, year, closed_at) VALUES (?, ?, ?, NOW())",
        [buildingId, month, year],
    );

    let successMessage = `Edificio ${buildingId}: ${apartments.length} recibos por $${totalToDistribute.toFixed(2)}.`;
    if (reserveFundAmount > 0) {
        successMessage += ` Incluye $${reserveFundAmount.toFixed(2)} de fondo de reserva.`;
    }
    return { successMessage, apartmentCount: apartments.length, totalToDistribute };
};

const previewComplexClose = async (complexId, month, year) => {
    const [buildings] = await db.query(
        `SELECT id, name, code FROM buildings 
         WHERE complex_id = ? AND status = 'ACTIVE' ORDER BY name ASC`,
        [complexId],
    );

    const buildingPreviews = [];
    for (const b of buildings) {
        buildingPreviews.push(
            await previewBuildingClose(b.id, month, year, {
                name: b.name,
                code: b.code,
            }),
        );
    }

    const closeable = buildingPreviews.filter((p) => p.canClose);
    const totalToDistribute = closeable.reduce(
        (s, p) => s + Number(p.summary.totalToDistribute || 0),
        0,
    );

    return {
        month,
        year,
        complexId: Number(complexId),
        buildings: buildingPreviews,
        summary: {
            buildingCount: buildingPreviews.length,
            closeableCount: closeable.length,
            alreadyClosedCount: buildingPreviews.filter((p) => p.alreadyClosed)
                .length,
            totalToDistribute,
        },
    };
};

const countCloseableInComplex = async (complexId, month, year) => {
    const [buildings] = await db.query(
        `SELECT id FROM buildings WHERE complex_id = ? AND status = 'ACTIVE'`,
        [complexId],
    );
    let count = 0;
    for (const b of buildings) {
        const preview = await previewBuildingClose(b.id, month, year);
        if (preview.canClose) count += 1;
    }
    return count;
};

module.exports = {
    previewBuildingClose,
    previewComplexClose,
    executeBuildingClose,
    countCloseableInComplex,
    isPeriodClosed,
};