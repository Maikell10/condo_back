const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const complexId = 4;
    const month = 10;
    const year = 2026;

    const [concept] = await db.query(
        "SELECT id, code, description FROM expense_concepts WHERE code = '017'",
    );
    console.log("CONCEPT", concept);

    const [exp] = await db.query(
        `SELECT be.id, b.id as building_id, b.name, be.amount, be.expense_date
         FROM building_expenses be
         JOIN buildings b ON b.id = be.building_id
         JOIN expense_concepts ec ON ec.id = be.concept_id
         WHERE b.complex_id = ? AND ec.code = '017'
           AND MONTH(be.expense_date)=? AND YEAR(be.expense_date)=?`,
        [complexId, month, year],
    );
    console.log("EXPENSES 017", exp);

    const [buildings] = await db.query(
        "SELECT id, name FROM buildings WHERE complex_id = ? AND status='ACTIVE' ORDER BY name",
        [complexId],
    );
    console.log("BUILDINGS", buildings.length);

    const [jReceipts] = await db.query(
        `SELECT a.number, a.alicuota, r.id, r.amount, r.paid, r.status
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         WHERE a.building_id = 51 AND r.description = 'Condominio 10/2026'
         ORDER BY a.number LIMIT 5`,
    );
    const [aReceipts] = await db.query(
        `SELECT a.number, a.alicuota, r.id, r.amount, r.paid, r.status
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         WHERE a.building_id = 41 AND r.description = 'Condominio 10/2026'
         ORDER BY a.number LIMIT 5`,
    );
    console.log("J sample", jReceipts);
    console.log("A sample", aReceipts);

    const [sumAliq] = await db.query(
        `SELECT building_id, SUM(alicuota) as sum_alicuota, COUNT(*) c
         FROM apartments WHERE building_id IN (SELECT id FROM buildings WHERE complex_id=4)
         GROUP BY building_id LIMIT 5`,
    );
    console.log("ALICUOTA SUM sample", sumAliq);

    const [settings] = await db.query(
        `SELECT has_reserve_fund, reserve_fund_percentage FROM admin_settings WHERE admin_id = 1092`,
    );
    console.log("RESERVE", settings);

    const [jTotalExp] = await db.query(
        `SELECT SUM(be.amount) as total
         FROM building_expenses be
         WHERE be.building_id = 51 AND MONTH(be.expense_date)=10 AND YEAR(be.expense_date)=2026
           AND be.concept_id NOT IN (SELECT id FROM expense_concepts WHERE description='Fondo de Reserva')`,
    );
    const [aTotalExp] = await db.query(
        `SELECT SUM(be.amount) as total
         FROM building_expenses be
         WHERE be.building_id = 41 AND MONTH(be.expense_date)=10 AND YEAR(be.expense_date)=2026
           AND be.concept_id NOT IN (SELECT id FROM expense_concepts WHERE description='Fondo de Reserva')`,
    );
    console.log("J variable expenses total", jTotalExp[0]);
    console.log("A variable expenses total", aTotalExp[0]);

    process.exit(0);
})();
