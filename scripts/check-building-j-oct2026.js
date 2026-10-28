const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const BUILDING_ID = 51; // J
const MONTH = 10;
const YEAR = 2026;

(async () => {
    const [expenses] = await db.query(
        `SELECT be.id, ec.code, ec.description, be.amount, be.expense_date
         FROM building_expenses be
         JOIN expense_concepts ec ON ec.id = be.concept_id
         WHERE be.building_id = ? AND MONTH(be.expense_date)=? AND YEAR(be.expense_date)=?
         ORDER BY ec.code`,
        [BUILDING_ID, MONTH, YEAR],
    );
    console.log("GASTOS OCT J:", JSON.stringify(expenses, null, 2));

    const [receipts] = await db.query(
        `SELECT COUNT(*) c, MIN(amount) min_a, MAX(amount) max_a, SUM(amount) sum_a,
                SUM(paid) sum_paid, SUM(CASE WHEN paid>0 THEN 1 ELSE 0 END) with_pay
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         WHERE a.building_id = ? AND r.description = 'Condominio 10/2026'`,
        [BUILDING_ID],
    );
    console.log("RECIBOS:", receipts[0]);

    const [sample] = await db.query(
        `SELECT r.id, a.number, r.amount, r.paid, r.status
         FROM receipts r JOIN apartments a ON a.id=r.apartment_id
         WHERE a.building_id=? AND r.description='Condominio 10/2026' LIMIT 3`,
        [BUILDING_ID],
    );
    console.log("SAMPLE", sample);

    process.exit(0);
})();
