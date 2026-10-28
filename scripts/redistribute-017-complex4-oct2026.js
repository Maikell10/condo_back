/**
 * Reparte gasto 017 ($53.86) entre los 28 edificios del complejo 4 (ISTMO)
 * y ajusta recibos octubre/2026 (+ fondo reserva 10%).
 *
 * node scripts/redistribute-017-complex4-oct2026.js --dry-run
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const COMPLEX_ID = 4;
const ADMIN_USER_ID = 1092;
const CONCEPT_CODE = "017";
const TOTAL_AMOUNT = 53.86;
const MONTH = 10;
const YEAR = 2026;
const RECEIPT_DESCRIPTION = `Condominio ${MONTH}/${YEAR}`;
const EXPENSE_DATE = "2026-10-17";
const RESERVE_PCT = 0.1;
const DRY_RUN = process.argv.includes("--dry-run");

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

async function getReserveConceptId(conn) {
    const [rows] = await conn.query(
        "SELECT id FROM expense_concepts WHERE description = 'Fondo de Reserva' LIMIT 1",
    );
    return rows[0]?.id;
}

async function sumSubtotal(conn, buildingId, replace017With) {
    const paddedMonth = String(MONTH).padStart(2, "0");
    const firstDay = `${YEAR}-${paddedMonth}-01`;

    const [concept] = await conn.query(
        "SELECT id FROM expense_concepts WHERE code = ?",
        [CONCEPT_CODE],
    );
    const conceptId = concept[0].id;

    const [variableSum] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM building_expenses
         WHERE building_id = ? AND MONTH(expense_date)=? AND YEAR(expense_date)=?
           AND concept_id NOT IN (SELECT id FROM expense_concepts WHERE description = 'Fondo de Reserva')`,
        [buildingId, MONTH, YEAR],
    );

    const [cur017] = await conn.query(
        `SELECT COALESCE(SUM(amount),0) as a FROM building_expenses
         WHERE building_id=? AND concept_id=? AND MONTH(expense_date)=? AND YEAR(expense_date)=?`,
        [buildingId, conceptId, MONTH, YEAR],
    );

    const [fixedSum] = await conn.query(
        `SELECT COALESCE(SUM(monthly_amount), 0) as total
         FROM contracts
         WHERE building_id = ? AND is_active = 1
           AND start_date <= LAST_DAY(?) AND end_date >= ?`,
        [buildingId, firstDay, firstDay],
    );

    const variable =
        Number(variableSum[0].total) -
        Number(cur017[0].a) +
        Number(replace017With);
    const subtotal = variable + Number(fixedSum[0].total);
    const reserve = round2(subtotal * RESERVE_PCT);
    const total = round2(subtotal + reserve);
    return { subtotal: round2(subtotal), reserve, total, cur017: Number(cur017[0].a) };
}

function receiptStatus(paid, amount) {
    const p = Number(paid || 0);
    const a = Number(amount);
    if (p <= 0) return "PENDING";
    if (p >= a - 0.001) return "PAID";
    return "PARTIAL";
}

async function main() {
    const conn = await db.getConnection();
    try {
        const [complex] = await conn.query(
            "SELECT id, name, admin_id FROM residential_complexes WHERE id = ?",
            [COMPLEX_ID],
        );
        if (!complex.length || Number(complex[0].admin_id) !== ADMIN_USER_ID) {
            throw new Error("Complejo/admin no valido");
        }

        const [buildings] = await conn.query(
            "SELECT id, name FROM buildings WHERE complex_id = ? AND status = 'ACTIVE' ORDER BY id",
            [COMPLEX_ID],
        );
        if (buildings.length === 0) throw new Error("Sin edificios");

        const perBuildingShare = Number((TOTAL_AMOUNT / buildings.length).toFixed(2));
        console.log("Complejo:", complex[0].name);
        console.log("Edificios:", buildings.length, "| 017 por edificio:", perBuildingShare);

        const [concept] = await conn.query(
            "SELECT id, code, description FROM expense_concepts WHERE code = ?",
            [CONCEPT_CODE],
        );
        if (!concept.length) throw new Error("Concepto 017 no existe");
        const conceptId = concept[0].id;
        const reserveConceptId = await getReserveConceptId(conn);

        const plan = [];
        for (const b of buildings) {
            const [cur017Row] = await conn.query(
                `SELECT COALESCE(SUM(amount),0) as a FROM building_expenses
                 WHERE building_id=? AND concept_id=? AND MONTH(expense_date)=? AND YEAR(expense_date)=?`,
                [b.id, conceptId, MONTH, YEAR],
            );
            const cur017Amt = Number(cur017Row[0].a);

            const oldTotals = await sumSubtotal(conn, b.id, cur017Amt);
            const newTotals = await sumSubtotal(conn, b.id, perBuildingShare);
            const deltaTotal = round2(newTotals.total - oldTotals.total);

            const [receipts] = await conn.query(
                `SELECT r.id, r.amount, r.paid, r.status, a.alicuota
                 FROM receipts r
                 JOIN apartments a ON a.id = r.apartment_id
                 WHERE a.building_id = ? AND r.description = ?`,
                [b.id, RECEIPT_DESCRIPTION],
            );

            plan.push({
                building: b,
                cur017Amt,
                oldTotals,
                newTotals,
                deltaTotal,
                receipts,
            });
        }

        const totalReceiptDelta = plan.reduce((s, p) => s + p.deltaTotal, 0);
        console.log("Suma delta total edificios (debe ~0):", round2(totalReceiptDelta));

        const affectedPayments = plan.reduce(
            (s, p) => s + p.receipts.filter((r) => Number(r.paid) > 0).length,
            0,
        );
        console.log("Recibos con pago que cambiaran estatus/monto:", affectedPayments);

        if (DRY_RUN) {
            console.log("\n--- DRY RUN muestra ---");
            for (const p of plan.filter((x) => x.building.name === "J" || x.building.name === "A" || x.deltaTotal !== 0).slice(0, 5)) {
                console.log(
                    p.building.name,
                    "delta edificio:",
                    p.deltaTotal,
                    "ej apt 0.0625:",
                    round2(p.deltaTotal * 0.0625),
                );
            }
            return;
        }

        await conn.beginTransaction();

        for (const p of plan) {
            const bId = p.building.id;

            if (p.cur017Amt > 0) {
                await conn.query(
                    `UPDATE building_expenses SET amount = ?
                     WHERE building_id = ? AND concept_id = ?
                       AND MONTH(expense_date)=? AND YEAR(expense_date)=?`,
                    [perBuildingShare, bId, conceptId, MONTH, YEAR],
                );
            } else {
                await conn.query(
                    `INSERT INTO building_expenses (building_id, concept_id, amount, expense_date)
                     VALUES (?, ?, ?, ?)`,
                    [bId, conceptId, perBuildingShare, EXPENSE_DATE],
                );
            }

            if (reserveConceptId) {
                const [resRows] = await conn.query(
                    `SELECT id FROM building_expenses
                     WHERE building_id = ? AND concept_id = ?
                       AND MONTH(expense_date)=? AND YEAR(expense_date)=?`,
                    [bId, reserveConceptId, MONTH, YEAR],
                );
                if (resRows.length) {
                    await conn.query(
                        "UPDATE building_expenses SET amount = ? WHERE id = ?",
                        [p.newTotals.reserve, resRows[0].id],
                    );
                }
            }

            for (const r of p.receipts) {
                const inc = round2(p.deltaTotal * Number(r.alicuota));
                const newAmount = round2(Number(r.amount) + inc);
                const newStatus = receiptStatus(r.paid, newAmount);
                await conn.query(
                    "UPDATE receipts SET amount = ?, status = ? WHERE id = ?",
                    [newAmount, newStatus, r.id],
                );
            }

            console.log(
                `[OK] ${p.building.name}: 017=$${perBuildingShare}, delta recibo edificio $${p.deltaTotal}`,
            );
        }

        await conn.commit();
        console.log("\nRedistribucion 017 aplicada.");
    } catch (e) {
        try {
            await conn.rollback();
        } catch (_) {}
        throw e;
    } finally {
        conn.release();
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("ERROR:", e.message);
        process.exit(1);
    });
