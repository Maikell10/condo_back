/**
 * Edificio J (51): elimina gasto 017 oct/2026, recalcula Fondo de Reserva y recibos.
 * node scripts/fix-building-j-remove-017-oct2026.js [--dry-run]
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const BUILDING_ID = 51;
const BUILDING_NAME = "J";
const EXPENSE_017_ID = 3281;
const MONTH = 10;
const YEAR = 2026;
const RECEIPT_DESCRIPTION = `Condominio ${MONTH}/${YEAR}`;
const RESERVE_PCT = 0.1;
const DRY_RUN = process.argv.includes("--dry-run");

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

async function computeTotals(conn, buildingId) {
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

    const subtotal = round2(Number(variableSum[0].total) + Number(fixedSum[0].total));
    const reserve = round2(subtotal * RESERVE_PCT);
    const total = round2(subtotal + reserve);
    return { subtotal, reserve, total };
}

(async () => {
    const conn = await db.getConnection();
    try {
        const [b] = await conn.query(
            "SELECT id, name FROM buildings WHERE id = ?",
            [BUILDING_ID],
        );
        if (!b.length || b[0].name !== BUILDING_NAME) {
            throw new Error("Edificio J no encontrado");
        }

        const [e017] = await conn.query(
            "SELECT id, amount FROM building_expenses WHERE id = ? AND building_id = ?",
            [EXPENSE_017_ID, BUILDING_ID],
        );
        if (!e017.length) {
            throw new Error("Gasto 017 no encontrado (ya eliminado?)");
        }

        const [withPay] = await conn.query(
            `SELECT COUNT(*) c FROM receipts r
             JOIN apartments a ON a.id = r.apartment_id
             WHERE a.building_id = ? AND r.description = ? AND r.paid > 0`,
            [BUILDING_ID, RECEIPT_DESCRIPTION],
        );
        if (Number(withPay[0].c) > 0) {
            throw new Error("Hay recibos con pagos; abortando.");
        }

        const before = await computeTotals(conn, BUILDING_ID);
        const after017Removed = round2(before.subtotal - Number(e017[0].amount));
        const afterReserve = round2(after017Removed * RESERVE_PCT);
        const afterTotal = round2(after017Removed + afterReserve);

        console.log("Antes (con 017):", before);
        console.log("Despues (sin 017):", {
            subtotal: after017Removed,
            reserve: afterReserve,
            total: afterTotal,
        });
        console.log("Delta total recibos edificio:", round2(afterTotal - before.total));

        const [reserveRow] = await conn.query(
            `SELECT be.id, be.amount FROM building_expenses be
             JOIN expense_concepts ec ON ec.id = be.concept_id
             WHERE be.building_id = ? AND ec.description = 'Fondo de Reserva'
               AND MONTH(be.expense_date)=? AND YEAR(be.expense_date)=?`,
            [BUILDING_ID, MONTH, YEAR],
        );
        console.log("Fondo reserva actual:", reserveRow[0]);

        const [receipts] = await conn.query(
            `SELECT r.id, a.alicuota, r.amount FROM receipts r
             JOIN apartments a ON a.id = r.apartment_id
             WHERE a.building_id = ? AND r.description = ?`,
            [BUILDING_ID, RECEIPT_DESCRIPTION],
        );

        const updates = receipts.map((r) => ({
            id: r.id,
            oldAmount: Number(r.amount),
            newAmount: round2(afterTotal * Number(r.alicuota)),
        }));

        console.log("Recibos a actualizar:", updates.length);
        console.log("Ejemplo:", updates[0]);

        if (DRY_RUN) {
            console.log("DRY RUN — sin cambios");
            return;
        }

        await conn.beginTransaction();

        await conn.query("DELETE FROM building_expenses WHERE id = ?", [EXPENSE_017_ID]);

        if (reserveRow.length) {
            await conn.query("UPDATE building_expenses SET amount = ? WHERE id = ?", [
                afterReserve,
                reserveRow[0].id,
            ]);
        }

        for (const u of updates) {
            await conn.query("UPDATE receipts SET amount = ?, status = 'PENDING' WHERE id = ?", [
                u.newAmount,
                u.id,
            ]);
        }

        await conn.commit();
        console.log("Correccion aplicada en edificio J.");
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
})()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("ERROR:", e.message);
        process.exit(1);
    });
