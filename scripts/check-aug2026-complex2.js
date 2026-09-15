const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const complexId = 2;
    const month = 8;
    const year = 2026;
    const desc = `Condominio ${month}/${year}`;
    const issueDate = `${year}-08-01`;

    const [summary] = await db.query(
        `SELECT b.id, b.name,
            COUNT(r.id) as receipts,
            SUM(CASE WHEN r.status='PAID' THEN 1 ELSE 0 END) as paid_count,
            SUM(CASE WHEN r.status='PARTIAL' THEN 1 ELSE 0 END) as partial_count,
            SUM(CASE WHEN r.status='PENDING' THEN 1 ELSE 0 END) as pending_count,
            SUM(r.paid) as total_paid
         FROM buildings b
         JOIN apartments a ON a.building_id = b.id
         JOIN receipts r ON r.apartment_id = a.id
         WHERE b.complex_id = ? AND (r.description = ? OR r.issue_date = ?)
         GROUP BY b.id, b.name
         ORDER BY b.name`,
        [complexId, desc, issueDate],
    );

    const [paymentsAug] = await db.query(
        `SELECT COUNT(DISTINCT p.id) as payment_count
         FROM payment_receipts pr
         JOIN payments p ON p.id = pr.payment_id
         JOIN receipts r ON r.id = pr.receipt_id
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ? AND (r.description = ? OR r.issue_date = ?)`,
        [complexId, desc, issueDate],
    );

    const [totals] = await db.query(
        `SELECT COUNT(r.id) as total_receipts,
            SUM(CASE WHEN r.paid > 0 THEN 1 ELSE 0 END) as with_any_payment,
            SUM(r.paid) as sum_paid
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ? AND (r.description = ? OR r.issue_date = ?)`,
        [complexId, desc, issueDate],
    );

    console.log("PERIODO:", `${month}/${year}`);
    console.log("POR EDIFICIO:", JSON.stringify(summary, null, 2));
    console.log("TOTALES COMPLEJO:", JSON.stringify(totals[0], null, 2));
    console.log("PAGOS VINCULADOS AL PERIODO:", paymentsAug[0].payment_count);

    const desc7 = "Condominio 7/2026";
    const [jul] = await db.query(
        `SELECT COUNT(r.id) as receipts,
            SUM(CASE WHEN r.status='PAID' THEN 1 ELSE 0 END) as paid,
            SUM(CASE WHEN r.status='PARTIAL' THEN 1 ELSE 0 END) as partial,
            SUM(CASE WHEN r.status='PENDING' THEN 1 ELSE 0 END) as pending,
            COUNT(DISTINCT pr.payment_id) as linked_payments
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         LEFT JOIN payment_receipts pr ON pr.receipt_id = r.id
         WHERE b.complex_id = 2 AND r.description = ?`,
        [desc7],
    );
    console.log("COMPARACION JULIO/2026:", JSON.stringify(jul[0], null, 2));

    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
