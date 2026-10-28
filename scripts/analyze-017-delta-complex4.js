const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const TOTAL_017 = 53.86;
const BUILDINGS_COUNT = 28;
const SHARE = TOTAL_017 / BUILDINGS_COUNT;
const MONTH = 10;
const YEAR = 2026;
const RESERVE_PCT = 0.1;

async function buildingSubtotal(conn, buildingId, concept017Amount) {
    const paddedMonth = String(MONTH).padStart(2, "0");
    const firstDay = `${YEAR}-${paddedMonth}-01`;

    const [variableSum] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM building_expenses
         WHERE building_id = ? AND MONTH(expense_date)=? AND YEAR(expense_date)=?
           AND concept_id NOT IN (SELECT id FROM expense_concepts WHERE description = 'Fondo de Reserva')`,
        [buildingId, MONTH, YEAR],
    );

    const [fixedSum] = await conn.query(
        `SELECT COALESCE(SUM(monthly_amount), 0) as total
         FROM contracts
         WHERE building_id = ? AND is_active = 1
           AND start_date <= LAST_DAY(?) AND end_date >= ?`,
        [buildingId, firstDay, firstDay],
    );

    let variable = Number(variableSum[0].total);
    const [current017] = await conn.query(
        `SELECT COALESCE(SUM(amount),0) as a FROM building_expenses be
         JOIN expense_concepts ec ON ec.id = be.concept_id
         WHERE be.building_id=? AND ec.code='017' AND MONTH(be.expense_date)=? AND YEAR(be.expense_date)=?`,
        [buildingId, MONTH, YEAR],
    );
    const cur017 = Number(current017[0].a);
    variable = variable - cur017 + concept017Amount;

    const subtotal = variable + Number(fixedSum[0].total);
    const reserve = subtotal * RESERVE_PCT;
    return { subtotal, reserve, total: subtotal + reserve, cur017 };
}

(async () => {
    const conn = await db.getConnection();
    const [buildings] = await conn.query(
        "SELECT id, name FROM buildings WHERE complex_id=4 AND status='ACTIVE' ORDER BY name",
    );

    for (const b of buildings.slice(0, 3)) {
        const old = await buildingSubtotal(conn, b.id, b.name === "J" ? 53.86 : 0);
        const neu = await buildingSubtotal(conn, b.id, SHARE);
        const [receiptSum] = await conn.query(
            `SELECT SUM(r.amount) as s FROM receipts r
             JOIN apartments a ON a.id=r.apartment_id
             WHERE a.building_id=? AND r.description='Condominio 10/2026'`,
            [b.id],
        );
        console.log(b.name, {
            oldTotal: old.total,
            newTotal: neu.total,
            delta: neu.total - old.total,
            receiptSum: Number(receiptSum[0].s),
        });
    }

    const jOld = await buildingSubtotal(conn, 51, 53.86);
    const jNew = await buildingSubtotal(conn, 51, SHARE);
    const aOld = await buildingSubtotal(conn, 41, 0);
    const aNew = await buildingSubtotal(conn, 41, SHARE);
    console.log("J delta total", jNew.total - jOld.total, "per apt 0.0625", (jNew.total - jOld.total) * 0.0625);
    console.log("A delta total", aNew.total - aOld.total, "per apt", (aNew.total - aOld.total) * 0.0625);

    conn.release();
    process.exit(0);
})();
