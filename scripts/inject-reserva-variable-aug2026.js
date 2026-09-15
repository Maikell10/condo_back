/**
 * Inyecta concepto 029 Fondo de Reserva Variable ($40/edificio, +$1/recibo)
 * para agosto 2026 en todos los edificios del complejo 2.
 *
 * Uso: node scripts/inject-reserva-variable-aug2026.js [--dry-run]
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const COMPLEX_ID = 2;
const ADMIN_USER_ID = 6;
const MONTH = 8;
const YEAR = 2026;
const EXPENSE_PER_BUILDING = 40;
const RECEIPT_INCREMENT = 1;
const EXPENSE_DATE = "2026-08-28";
const RECEIPT_DESCRIPTION = `Condominio ${MONTH}/${YEAR}`;
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    const connection = await db.getConnection();
    try {
        const [concepts] = await connection.query(
            "SELECT id, code, description FROM expense_concepts WHERE code = ?",
            ["029"],
        );
        if (!concepts.length) {
            throw new Error("No existe el concepto 029 en expense_concepts");
        }
        const conceptId = concepts[0].id;
        console.log("Concepto:", concepts[0]);

        const [complex] = await connection.query(
            "SELECT id, name, admin_id FROM residential_complexes WHERE id = ?",
            [COMPLEX_ID],
        );
        if (!complex.length || Number(complex[0].admin_id) !== ADMIN_USER_ID) {
            throw new Error(
                `Complejo ${COMPLEX_ID} no pertenece al admin ${ADMIN_USER_ID}`,
            );
        }
        console.log("Complejo:", complex[0]);

        const [buildings] = await connection.query(
            "SELECT id, name FROM buildings WHERE complex_id = ? AND status = 'ACTIVE' ORDER BY id",
            [COMPLEX_ID],
        );
        console.log(`Edificios activos: ${buildings.length}`);

        const [receiptStats] = await connection.query(
            `SELECT COUNT(*) as total,
                    SUM(CASE WHEN r.paid > 0 THEN 1 ELSE 0 END) as with_payments
             FROM receipts r
             JOIN apartments a ON a.id = r.apartment_id
             JOIN buildings b ON b.id = a.building_id
             WHERE b.complex_id = ? AND r.description = ?`,
            [COMPLEX_ID, RECEIPT_DESCRIPTION],
        );
        console.log("Recibos agosto/2026:", receiptStats[0]);

        if (Number(receiptStats[0].with_payments) > 0) {
            throw new Error(
                "Hay recibos con pagos en este periodo. Abortando por seguridad.",
            );
        }

        const [existing] = await connection.query(
            `SELECT be.id, b.name, be.amount
             FROM building_expenses be
             JOIN buildings b ON b.id = be.building_id
             WHERE b.complex_id = ? AND be.concept_id = ?
               AND MONTH(be.expense_date) = ? AND YEAR(be.expense_date) = ?`,
            [COMPLEX_ID, conceptId, MONTH, YEAR],
        );
        if (existing.length > 0) {
            console.log("Ya existen gastos 029 para agosto:", existing);
            throw new Error("La inyeccion ya parece aplicada. Revisar antes de continuar.");
        }

        await connection.beginTransaction();

        let expensesInserted = 0;
        let receiptsUpdated = 0;

        for (const building of buildings) {
            const [aptCount] = await connection.query(
                "SELECT COUNT(*) as c FROM apartments WHERE building_id = ?",
                [building.id],
            );
            const apartments = Number(aptCount[0].c);
            const expectedTotal = apartments * RECEIPT_INCREMENT;

            if (expectedTotal !== EXPENSE_PER_BUILDING && apartments !== 40) {
                console.warn(
                    `AVISO edificio ${building.name}: ${apartments} aptos -> $${expectedTotal} (esperado $${EXPENSE_PER_BUILDING})`,
                );
            }

            if (!DRY_RUN) {
                await connection.query(
                    `INSERT INTO building_expenses (building_id, concept_id, amount, expense_date)
                     VALUES (?, ?, ?, ?)`,
                    [building.id, conceptId, EXPENSE_PER_BUILDING, EXPENSE_DATE],
                );
            }
            expensesInserted++;

            let updated = 0;
            if (DRY_RUN) {
                const [rows] = await connection.query(
                    `SELECT COUNT(*) as c FROM receipts r
                     JOIN apartments a ON a.id = r.apartment_id
                     WHERE a.building_id = ? AND r.description = ?`,
                    [building.id, RECEIPT_DESCRIPTION],
                );
                updated = Number(rows[0].c);
            } else {
                const [result] = await connection.query(
                    `UPDATE receipts r
                     JOIN apartments a ON a.id = r.apartment_id
                     SET r.amount = ROUND(r.amount + ?, 2)
                     WHERE a.building_id = ? AND r.description = ?`,
                    [RECEIPT_INCREMENT, building.id, RECEIPT_DESCRIPTION],
                );
                updated = result.affectedRows;
            }
            receiptsUpdated += updated;

            console.log(
                `${DRY_RUN ? "[DRY]" : "[OK]"} ${building.name}: gasto $${EXPENSE_PER_BUILDING}, recibos +$${RECEIPT_INCREMENT} (${updated} aptos)`,
            );
        }

        if (DRY_RUN) {
            await connection.rollback();
            console.log("\nDRY RUN — no se guardaron cambios.");
        } else {
            await connection.commit();
            console.log("\nInyeccion completada.");
        }

        console.log(`Gastos insertados: ${expensesInserted}`);
        console.log(`Recibos actualizados: ${receiptsUpdated}`);

        const [verify] = await connection.query(
            `SELECT b.name,
                    (SELECT be.amount FROM building_expenses be
                     WHERE be.building_id = b.id AND be.concept_id = ?
                       AND MONTH(be.expense_date)=? AND YEAR(be.expense_date)=? LIMIT 1) as expense_029,
                    (SELECT MIN(r.amount) FROM receipts r
                     JOIN apartments a ON a.id = r.apartment_id
                     WHERE a.building_id = b.id AND r.description = ?) as min_receipt,
                    (SELECT MAX(r.amount) FROM receipts r
                     JOIN apartments a ON a.id = r.apartment_id
                     WHERE a.building_id = b.id AND r.description = ?) as max_receipt
             FROM buildings b
             WHERE b.complex_id = ?
             ORDER BY b.name`,
            [conceptId, MONTH, YEAR, RECEIPT_DESCRIPTION, RECEIPT_DESCRIPTION, COMPLEX_ID],
        );
        console.log("\nVerificacion (muestra):");
        console.log(JSON.stringify(verify.slice(0, 3), null, 2));
        console.log("...");
        console.log(JSON.stringify(verify.slice(-1), null, 2));
    } catch (error) {
        try {
            await connection.rollback();
        } catch (_) {
            /* ignore */
        }
        throw error;
    } finally {
        connection.release();
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("ERROR:", error.message);
        if (error.stack) console.error(error.stack);
        process.exit(1);
    });
