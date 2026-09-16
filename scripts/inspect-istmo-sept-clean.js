const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const complexId = 4;
    const month = 9;
    const year = 2026;

    const [receipts] = await db.query(
        `SELECT COUNT(*) AS receipts,
                ROUND(SUM(r.amount), 2) AS total_amount,
                ROUND(SUM(r.paid), 2) AS total_paid,
                SUM(r.status = 'PENDING') AS pending,
                MIN(r.amount) AS min_amt,
                MAX(r.amount) AS max_amt,
                MIN(r.issue_date) AS min_date,
                MAX(r.issue_date) AS max_date,
                MIN(r.description) AS sample_desc
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ? AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?`,
        [complexId, month, year],
    );

    const [byBuilding] = await db.query(
        `SELECT b.name, COUNT(a.id) AS aptos,
                ROUND(MAX(a.alicuota)*100, 2) AS ali_pct,
                (SELECT ROUND(SUM(be.amount), 2)
                   FROM building_expenses be
                  WHERE be.building_id = b.id
                    AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?) AS expenses,
                COUNT(r.id) AS receipts,
                ROUND(MIN(r.amount), 2) AS rec_min,
                ROUND(MAX(r.amount), 2) AS rec_max,
                ROUND(SUM(r.amount), 2) AS rec_total
         FROM buildings b
         JOIN apartments a ON a.building_id = b.id
         LEFT JOIN receipts r ON r.apartment_id = a.id
           AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?
         WHERE b.complex_id = ?
         GROUP BY b.id, b.name
         ORDER BY COUNT(a.id), b.name`,
        [month, year, month, year, complexId],
    );

    const [concepts] = await db.query(
        `SELECT ec.code, ec.description,
                COUNT(*) AS expense_rows,
                COUNT(DISTINCT be.building_id) AS building_count,
                ROUND(MIN(be.amount), 2) AS min_amt,
                ROUND(MAX(be.amount), 2) AS max_amt,
                ROUND(SUM(be.amount), 2) AS total
         FROM building_expenses be
         JOIN buildings b ON b.id = be.building_id
         JOIN expense_concepts ec ON ec.id = be.concept_id
         WHERE b.complex_id = ? AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?
         GROUP BY ec.id, ec.code, ec.description
         ORDER BY ec.description`,
        [complexId, month, year],
    );

    const [settings] = await db.query(
        "SELECT * FROM admin_settings WHERE admin_id = 1092",
    );

    const [periods] = await db.query(
        `SELECT COUNT(*) AS periods FROM billing_periods bp
         JOIN buildings b ON b.id = bp.building_id
         WHERE b.complex_id = ? AND bp.month = ? AND bp.year = ?`,
        [complexId, month, year],
    );

    const [payments] = await db.query(
        `SELECT COUNT(*) AS links FROM payment_receipts pr
         JOIN receipts r ON r.id = pr.receipt_id
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ? AND MONTH(r.issue_date) = ? AND YEAR(r.issue_date) = ?`,
        [complexId, month, year],
    );

    console.log(JSON.stringify({ receipts: receipts[0], periods: periods[0], payments: payments[0], settings, byBuilding, concepts }, null, 2));
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
