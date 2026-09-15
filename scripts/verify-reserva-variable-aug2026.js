const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const [admin] = await db.query(
        "SELECT rc.id, rc.name, rc.admin_id FROM residential_complexes rc WHERE rc.id = 2 AND rc.admin_id = 6",
    );
    console.log("COMPLEJO/ADMIN:", admin);

    const [expenses] = await db.query(
        `SELECT b.name, be.amount, ec.code, ec.description, be.expense_date
         FROM building_expenses be
         JOIN expense_concepts ec ON ec.id = be.concept_id
         JOIN buildings b ON b.id = be.building_id
         WHERE b.complex_id = 2 AND ec.code = '029'
           AND MONTH(be.expense_date)=8 AND YEAR(be.expense_date)=2026
         ORDER BY b.name`,
    );
    console.log("GASTOS 029 INSERTADOS:", expenses.length);
    console.log(JSON.stringify(expenses.slice(0, 3), null, 2));

    const [receipts] = await db.query(
        `SELECT b.name,
                COUNT(*) as receipts,
                MIN(r.amount) as min_amount,
                MAX(r.amount) as max_amount,
                SUM(r.amount) as total_billed
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = 2 AND r.description = 'Condominio 8/2026'
         GROUP BY b.id, b.name
         ORDER BY b.name`,
    );
    console.log("RECIBOS POR EDIFICIO:");
    console.log(JSON.stringify(receipts, null, 2));

    const [totals] = await db.query(
        `SELECT COUNT(*) as receipts, SUM(r.amount) as total, SUM(r.paid) as paid
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = 2 AND r.description = 'Condominio 8/2026'`,
    );
    console.log("TOTALES:", totals[0]);

    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
