const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");
const { allocateByWeights } = require("../src/utils/expense-split");

const APPLY = process.argv.includes("--apply");
const COMPLEX_ID = 4;
const ADMIN_ID = 1092;
const MONTH = 9;
const YEAR = 2026;

(async () => {
    const connection = await db.getConnection();

    try {
        const [[receipts]] = await connection.query(
            `SELECT COUNT(*) AS n, ROUND(SUM(r.amount), 2) AS total,
                    ROUND(SUM(r.paid), 2) AS paid,
                    SUM(r.status = 'PENDING') AS pending
             FROM receipts r
             JOIN apartments a ON a.id = r.apartment_id
             JOIN buildings b ON b.id = a.building_id
             WHERE b.complex_id = ? AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const [[links]] = await connection.query(
            `SELECT COUNT(*) AS n
             FROM payment_receipts pr
             JOIN receipts r ON r.id = pr.receipt_id
             JOIN apartments a ON a.id = r.apartment_id
             JOIN buildings b ON b.id = a.building_id
             WHERE b.complex_id = ? AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const [[periods]] = await connection.query(
            `SELECT COUNT(*) AS n FROM billing_periods bp
             JOIN buildings b ON b.id = bp.building_id
             WHERE b.complex_id = ? AND bp.month = ? AND bp.year = ?`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const [[reserve]] = await connection.query(
            `SELECT COUNT(*) AS n, ROUND(SUM(be.amount), 2) AS total
             FROM building_expenses be
             JOIN buildings b ON b.id = be.building_id
             JOIN expense_concepts ec ON ec.id = be.concept_id
             WHERE b.complex_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
               AND ec.description = 'Fondo de Reserva'`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const [buildings] = await connection.query(
            `SELECT b.id, b.name, COUNT(a.id) AS apt_count
             FROM buildings b
             LEFT JOIN apartments a ON a.building_id = b.id
             WHERE b.complex_id = ? AND b.status = 'ACTIVE'
             GROUP BY b.id, b.name
             ORDER BY b.id`,
            [COMPLEX_ID],
        );

        console.log("SELECT — lo que se va a tocar:", {
            apply: APPLY,
            receipts,
            paymentLinks: links,
            periods,
            reserveFundExpenses: reserve,
            buildings: buildings.length,
            aptos: buildings.reduce((s, b) => s + Number(b.apt_count), 0),
        });

        if (Number(links.n) > 0 || Number(receipts.paid) > 0) {
            throw new Error("Hay pagos aplicados. Abortando.");
        }
        if (Number(receipts.n) !== 432 || Number(periods.n) !== 28) {
            throw new Error(
                `Conteo inesperado: receipts=${receipts.n} periods=${periods.n}`,
            );
        }

        if (!APPLY) {
            console.log("Dry-run. Pasa --apply para ejecutar.");
            return;
        }

        await connection.beginTransaction();

        const [cols] = await connection.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'admin_settings'
               AND COLUMN_NAME = 'expense_split_mode'`,
        );
        if (cols.length === 0) {
            await connection.query(
                `ALTER TABLE admin_settings
                 ADD COLUMN expense_split_mode VARCHAR(20) NOT NULL DEFAULT 'BY_APARTMENT'
                 AFTER reserve_fund_percentage`,
            );
            console.log("ALTER admin_settings.expense_split_mode OK");
        }

        const [delReceipts] = await connection.query(
            `DELETE r FROM receipts r
             JOIN apartments a ON a.id = r.apartment_id
             JOIN buildings b ON b.id = a.building_id
             WHERE b.complex_id = ? AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const [delPeriods] = await connection.query(
            `DELETE bp FROM billing_periods bp
             JOIN buildings b ON b.id = bp.building_id
             WHERE b.complex_id = ? AND bp.month = ? AND bp.year = ?`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const [delReserve] = await connection.query(
            `DELETE be FROM building_expenses be
             JOIN buildings b ON b.id = be.building_id
             JOIN expense_concepts ec ON ec.id = be.concept_id
             WHERE b.complex_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
               AND ec.description = 'Fondo de Reserva'`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const [groups] = await connection.query(
            `SELECT be.concept_id, be.expense_date, ROUND(SUM(be.amount), 2) AS total
             FROM building_expenses be
             JOIN buildings b ON b.id = be.building_id
             WHERE b.complex_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
             GROUP BY be.concept_id, be.expense_date`,
            [COMPLEX_ID, MONTH, YEAR],
        );

        const weights = buildings.map((b) => Number(b.apt_count) || 0);
        let updatedExpenses = 0;

        for (const group of groups) {
            const shares = allocateByWeights(group.total, weights);
            for (let i = 0; i < buildings.length; i++) {
                const [upd] = await connection.query(
                    `UPDATE building_expenses
                     SET amount = ?
                     WHERE building_id = ? AND concept_id = ? AND expense_date = ?`,
                    [shares[i], buildings[i].id, group.concept_id, group.expense_date],
                );
                updatedExpenses += upd.affectedRows;
            }
        }

        await connection.query(
            `INSERT INTO admin_settings (admin_id, has_reserve_fund, reserve_fund_percentage, expense_split_mode)
             VALUES (?, 1, 10, 'BY_APARTMENT')
             ON DUPLICATE KEY UPDATE expense_split_mode = 'BY_APARTMENT'`,
            [ADMIN_ID],
        );

        const [after] = await connection.query(
            `SELECT b.name, COUNT(a.id) AS aptos, ROUND(SUM(be.amount), 2) AS expenses
             FROM buildings b
             JOIN apartments a ON a.building_id = b.id
             LEFT JOIN building_expenses be
               ON be.building_id = b.id
              AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
             WHERE b.complex_id = ?
             GROUP BY b.id, b.name
             HAVING b.name IN ('A', 'S', 'Ñ')
             ORDER BY b.name`,
            [MONTH, YEAR, COMPLEX_ID],
        );

        await connection.commit();
        console.log("APPLY OK", {
            deletedReceipts: delReceipts.affectedRows,
            deletedPeriods: delPeriods.affectedRows,
            deletedReserve: delReserve.affectedRows,
            updatedExpenses,
            sampleAfter: after,
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
        process.exit(0);
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
