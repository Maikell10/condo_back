const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const ADMIN_USER_ID = 1092;
const MONTH = 10;
const YEAR = 2026;
const RECEIPT_DESCRIPTION = `Condominio ${MONTH}/${YEAR}`;
const ISSUE_DATE = `${YEAR}-10-01`;

(async () => {
    const [user] = await db.query(
        "SELECT id, name, email, role FROM users WHERE id = ?",
        [ADMIN_USER_ID],
    );
    console.log("=== ADMIN USER ===");
    console.log(JSON.stringify(user, null, 2));

    const [complexes] = await db.query(
        `SELECT rc.id, rc.name, rc.admin_id
         FROM residential_complexes rc
         WHERE rc.id = 4 OR rc.admin_id = ?
         ORDER BY rc.id`,
        [ADMIN_USER_ID],
    );
    console.log("\n=== COMPLEJO(S) ===");
    console.log(JSON.stringify(complexes, null, 2));

    const complexId = 4;
    const [complex] = await db.query(
        "SELECT id, name, admin_id FROM residential_complexes WHERE id = ?",
        [complexId],
    );
    if (!complex.length) {
        console.log("No existe complex_id 4");
        process.exit(1);
    }
    if (Number(complex[0].admin_id) !== ADMIN_USER_ID) {
        console.log(
            `AVISO: complex 4 admin_id=${complex[0].admin_id}, no coincide con ${ADMIN_USER_ID}`,
        );
    }

    const [buildings] = await db.query(
        "SELECT id, name, status FROM buildings WHERE complex_id = ? ORDER BY id",
        [complexId],
    );
    console.log("\n=== EDIFICIOS (complex 4) ===");
    console.log(JSON.stringify(buildings, null, 2));

    const buildingIds = buildings.map((b) => b.id);
    if (!buildingIds.length) process.exit(0);

    const ph = buildingIds.map(() => "?").join(",");
    const [periods] = await db.query(
        `SELECT bp.id, bp.building_id, b.name as building_name, bp.month, bp.year, bp.closed_at, bp.status
         FROM billing_periods bp
         JOIN buildings b ON b.id = bp.building_id
         WHERE bp.building_id IN (${ph}) AND bp.month = ? AND bp.year = ?
         ORDER BY b.name`,
        [...buildingIds, MONTH, YEAR],
    );
    console.log(`\n=== CIERRES OCTUBRE ${YEAR} ===`);
    console.log("Edificios cerrados:", periods.length, "de", buildings.length);
    console.log(JSON.stringify(periods, null, 2));

    const [receiptSummary] = await db.query(
        `SELECT b.id, b.name,
            COUNT(r.id) as receipts,
            SUM(CASE WHEN r.status='PAID' THEN 1 ELSE 0 END) as paid_count,
            SUM(CASE WHEN r.status='PARTIAL' THEN 1 ELSE 0 END) as partial_count,
            SUM(CASE WHEN r.status='PENDING' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN r.paid > 0 THEN 1 ELSE 0 END) as with_any_payment,
            SUM(r.amount) as total_amount,
            SUM(r.paid) as total_paid
         FROM buildings b
         JOIN apartments a ON a.building_id = b.id
         LEFT JOIN receipts r ON r.apartment_id = a.id
           AND (r.description = ? OR r.issue_date = ?)
         WHERE b.complex_id = ?
         GROUP BY b.id, b.name
         ORDER BY b.name`,
        [RECEIPT_DESCRIPTION, ISSUE_DATE, complexId],
    );
    console.log("\n=== RECIBOS OCTUBRE POR EDIFICIO ===");
    console.log(JSON.stringify(receiptSummary, null, 2));

    const [totals] = await db.query(
        `SELECT COUNT(r.id) as total_receipts,
            SUM(CASE WHEN r.paid > 0 THEN 1 ELSE 0 END) as receipts_with_payment,
            SUM(r.paid) as sum_paid
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ? AND (r.description = ? OR r.issue_date = ?)`,
        [complexId, RECEIPT_DESCRIPTION, ISSUE_DATE],
    );
    console.log("\n=== TOTALES COMPLEJO OCTUBRE ===");
    console.log(JSON.stringify(totals[0], null, 2));

    const [linkedPayments] = await db.query(
        `SELECT p.id, p.status, p.amount, p.payment_date, p.reference,
                a.number as apartment, b.name as building,
                pr.receipt_id, pr.allocated_amount,
                r.description as receipt_desc, r.amount as receipt_amount, r.paid as receipt_paid
         FROM payment_receipts pr
         JOIN payments p ON p.id = pr.payment_id
         JOIN receipts r ON r.id = pr.receipt_id
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ?
           AND (r.description = ? OR r.issue_date = ?)
         ORDER BY p.payment_date DESC, p.id DESC`,
        [complexId, RECEIPT_DESCRIPTION, ISSUE_DATE],
    );
    console.log("\n=== PAGOS VINCULADOS A RECIBOS OCTUBRE ===");
    console.log("Total cruces payment_receipts:", linkedPayments.length);
    console.log(
        "Pagos distintos:",
        new Set(linkedPayments.map((p) => p.id)).size,
    );
    if (linkedPayments.length) {
        console.log(JSON.stringify(linkedPayments, null, 2));
    }

    const [pendingApproval] = await db.query(
        `SELECT p.id, p.status, p.amount, p.payment_date, p.reference, a.number as apartment, b.name as building
         FROM payments p
         JOIN apartments a ON a.id = p.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ?
           AND p.status IN ('PENDING_APPROVAL', 'APPROVED')
           AND p.payment_date >= ? AND p.payment_date < ?
         ORDER BY p.payment_date DESC`,
        [complexId, `${YEAR}-10-01`, `${YEAR}-11-01`],
    );
    console.log("\n=== PAGOS REPORTADOS EN OCT (cualquier recibo) ===");
    console.log("Total:", pendingApproval.length);
    if (pendingApproval.length) {
        console.log(JSON.stringify(pendingApproval.slice(0, 20), null, 2));
        if (pendingApproval.length > 20) console.log("... (truncado)");
    }

    const [compact] = await db.query(
        `SELECT COUNT(r.id) as total_receipts,
            SUM(CASE WHEN r.paid > 0 THEN 1 ELSE 0 END) as receipts_with_payment,
            SUM(CASE WHEN r.status = 'PAID' THEN 1 ELSE 0 END) as paid_receipts,
            SUM(CASE WHEN r.status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_receipts,
            SUM(r.paid) as sum_paid
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ? AND r.description = ?`,
        [complexId, RECEIPT_DESCRIPTION],
    );
    const [pr] = await db.query(
        `SELECT COUNT(DISTINCT pr.payment_id) as distinct_payments,
                COUNT(*) as payment_links
         FROM payment_receipts pr
         JOIN receipts r ON r.id = pr.receipt_id
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ? AND r.description = ?`,
        [complexId, RECEIPT_DESCRIPTION],
    );
    const [pendingOct] = await db.query(
        `SELECT COUNT(*) as c
         FROM payments p
         JOIN apartments a ON a.id = p.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ?
           AND p.status = 'PENDING_APPROVAL'
           AND p.payment_date >= ? AND p.payment_date < ?`,
        [complexId, `${YEAR}-10-01`, `${YEAR}-11-01`],
    );
    console.log("\n=== RESUMEN EJECUTIVO ===");
    console.log(JSON.stringify({ receipts: compact[0], payment_receipts: pr[0], pending_approval_oct: pendingOct[0] }, null, 2));

    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
