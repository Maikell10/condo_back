const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const [[admin]] = await db.query(
        "SELECT id, email, name, role FROM users WHERE email = ?",
        ["istmo@gmail.com"],
    );
    if (!admin) {
        console.log("NO_ADMIN");
        process.exit(1);
    }

    const [complexes] = await db.query(
        "SELECT id, name, admin_id FROM residential_complexes WHERE admin_id = ?",
        [admin.id],
    );

    const [buildings] = await db.query(
        `SELECT b.id, b.name, b.status, b.complex_id,
                COUNT(a.id) AS aptos,
                ROUND(MIN(a.alicuota) * 100, 4) AS min_ali_pct,
                ROUND(MAX(a.alicuota) * 100, 4) AS max_ali_pct,
                ROUND(SUM(a.alicuota) * 100, 4) AS suma_ali_pct
         FROM buildings b
         LEFT JOIN apartments a ON a.building_id = b.id
         WHERE b.complex_id IN (SELECT id FROM residential_complexes WHERE admin_id = ?)
         GROUP BY b.id, b.name, b.status, b.complex_id
         ORDER BY b.name`,
        [admin.id],
    );

    const [periods] = await db.query(
        `SELECT bp.id, bp.building_id, b.name AS building, bp.month, bp.year,
                bp.status, bp.closed_at
         FROM billing_periods bp
         JOIN buildings b ON b.id = bp.building_id
         WHERE b.complex_id IN (SELECT id FROM residential_complexes WHERE admin_id = ?)
         ORDER BY bp.year DESC, bp.month DESC, b.name`,
        [admin.id],
    );

    const [receiptSummary] = await db.query(
        `SELECT YEAR(r.issue_date) AS year, MONTH(r.issue_date) AS month, r.description,
                COUNT(*) AS receipts,
                ROUND(SUM(r.amount), 2) AS total_amount,
                ROUND(SUM(r.paid), 2) AS total_paid,
                SUM(CASE WHEN r.status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN r.status = 'PARTIAL' THEN 1 ELSE 0 END) AS partial,
                SUM(CASE WHEN r.status = 'PAID' THEN 1 ELSE 0 END) AS paid,
                SUM(CASE WHEN r.paid > 0 THEN 1 ELSE 0 END) AS with_payment
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id IN (SELECT id FROM residential_complexes WHERE admin_id = ?)
         GROUP BY YEAR(r.issue_date), MONTH(r.issue_date), r.description
         ORDER BY year DESC, month DESC`,
        [admin.id],
    );

    const [expenseByMonth] = await db.query(
        `SELECT YEAR(be.expense_date) AS year, MONTH(be.expense_date) AS month,
                COUNT(*) AS expense_rows,
                COUNT(DISTINCT be.building_id) AS building_count,
                ROUND(SUM(be.amount), 2) AS total
         FROM building_expenses be
         JOIN buildings b ON b.id = be.building_id
         WHERE b.complex_id IN (SELECT id FROM residential_complexes WHERE admin_id = ?)
         GROUP BY YEAR(be.expense_date), MONTH(be.expense_date)
         ORDER BY year DESC, month DESC`,
        [admin.id],
    );

    const [septByBuilding] = await db.query(
        `SELECT b.id, b.name, COUNT(a.id) AS aptos,
                ROUND(MAX(a.alicuota) * 100, 2) AS ali_pct,
                ROUND(SUM(be.amount), 2) AS expenses,
                COUNT(DISTINCT be.id) AS expense_rows,
                COUNT(r.id) AS receipts,
                ROUND(SUM(r.amount), 2) AS receipt_total,
                ROUND(MIN(r.amount), 2) AS receipt_min,
                ROUND(MAX(r.amount), 2) AS receipt_max,
                ROUND(SUM(r.paid), 2) AS paid,
                SUM(CASE WHEN r.status = 'PENDING' THEN 1 ELSE 0 END) AS pending
         FROM buildings b
         LEFT JOIN apartments a ON a.building_id = b.id
         LEFT JOIN building_expenses be
            ON be.building_id = b.id AND MONTH(be.expense_date) = 9 AND YEAR(be.expense_date) = 2026
         LEFT JOIN receipts r
            ON r.apartment_id = a.id
           AND MONTH(r.issue_date) = 9 AND YEAR(r.issue_date) = 2026
         WHERE b.complex_id IN (SELECT id FROM residential_complexes WHERE admin_id = ?)
         GROUP BY b.id, b.name
         ORDER BY b.name`,
        [admin.id],
    );

    const [linkedPayments] = await db.query(
        `SELECT COUNT(DISTINCT pr.payment_id) AS payments,
                COUNT(pr.receipt_id) AS links
         FROM payment_receipts pr
         JOIN receipts r ON r.id = pr.receipt_id
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id IN (SELECT id FROM residential_complexes WHERE admin_id = ?)
           AND MONTH(r.issue_date) = 9 AND YEAR(r.issue_date) = 2026`,
        [admin.id],
    );

    const [augCompare] = await db.query(
        `SELECT b.name, COUNT(a.id) AS aptos,
                ROUND(MIN(r.amount), 2) AS receipt_min,
                ROUND(MAX(r.amount), 2) AS receipt_max,
                COUNT(r.id) AS receipts
         FROM buildings b
         JOIN apartments a ON a.building_id = b.id
         LEFT JOIN receipts r
            ON r.apartment_id = a.id
           AND MONTH(r.issue_date) = 8 AND YEAR(r.issue_date) = 2026
         WHERE b.complex_id IN (SELECT id FROM residential_complexes WHERE admin_id = ?)
         GROUP BY b.id, b.name
         HAVING b.name IN ('S', 'Ñ', 'N', 'A', 'B')
            OR COUNT(a.id) IN (8, 16)
         ORDER BY COUNT(a.id), b.name
         LIMIT 8`,
        [admin.id],
    );

    console.log(JSON.stringify({
        admin: { id: admin.id, email: admin.email, name: admin.name },
        complexes,
        buildingCount: buildings.length,
        aptosTotal: buildings.reduce((s, b) => s + Number(b.aptos), 0),
        buildings,
        periods,
        receiptSummary,
        expenseByMonth,
        septByBuilding,
        linkedPaymentsSept: linkedPayments[0],
        sampleAptsReceipts: augCompare,
    }, null, 2));

    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
