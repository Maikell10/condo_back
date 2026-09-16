const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const [[receipts]] = await db.query(
        `SELECT COUNT(*) AS n FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = 4 AND MONTH(r.issue_date) = 9 AND YEAR(r.issue_date) = 2026`,
    );
    const [[periods]] = await db.query(
        `SELECT COUNT(*) AS n FROM billing_periods bp
         JOIN buildings b ON b.id = bp.building_id
         WHERE b.complex_id = 4 AND bp.month = 9 AND bp.year = 2026`,
    );
    const [totals] = await db.query(
        `SELECT b.name, COUNT(a.id) AS aptos,
                ROUND((SELECT SUM(be.amount) FROM building_expenses be
                       WHERE be.building_id = b.id
                         AND MONTH(be.expense_date) = 9 AND YEAR(be.expense_date) = 2026), 2) AS expenses
         FROM buildings b
         JOIN apartments a ON a.building_id = b.id
         WHERE b.complex_id = 4 AND b.name IN ('A', 'S', 'Ñ')
         GROUP BY b.id, b.name
         ORDER BY b.name`,
    );
    const [[grand]] = await db.query(
        `SELECT ROUND(SUM(be.amount), 2) AS expenses
         FROM building_expenses be
         JOIN buildings b ON b.id = be.building_id
         WHERE b.complex_id = 4 AND MONTH(be.expense_date) = 9 AND YEAR(be.expense_date) = 2026`,
    );
    const [[settings]] = await db.query(
        "SELECT has_reserve_fund, reserve_fund_percentage, expense_split_mode FROM admin_settings WHERE admin_id = 1092",
    );
    console.log(JSON.stringify({ receipts, periods, totals, grand, settings }, null, 2));
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
