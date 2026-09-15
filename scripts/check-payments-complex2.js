const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    try {
        const complexId = 2;
        const adminUserId = 6;

        const [complex] = await db.query(
            "SELECT id, name, admin_id FROM residential_complexes WHERE id = ?",
            [complexId],
        );
        console.log("=== COMPLEJO ===");
        console.log(JSON.stringify(complex, null, 2));

        const [buildings] = await db.query(
            "SELECT id, name, admin_id, status FROM buildings WHERE complex_id = ? ORDER BY id",
            [complexId],
        );
        console.log("\n=== EDIFICIOS ===");
        console.log(JSON.stringify(buildings, null, 2));

        const buildingIds = buildings.map((b) => b.id);
        if (!buildingIds.length) {
            console.log("Sin edificios");
            process.exit(0);
        }

        const placeholders = buildingIds.map(() => "?").join(",");
        const [periods] = await db.query(
            `SELECT bp.id, bp.building_id, b.name as building_name, bp.month, bp.year, bp.closed_at, bp.status
             FROM billing_periods bp
             JOIN buildings b ON b.id = bp.building_id
             WHERE bp.building_id IN (${placeholders})
             ORDER BY bp.year DESC, bp.month DESC`,
            buildingIds,
        );
        console.log("\n=== PERIODOS CERRADOS (todos) ===");
        console.log(JSON.stringify(periods, null, 2));

        if (!periods.length) {
            console.log("Sin periodos cerrados");
            process.exit(0);
        }

        const latest = periods[0];
        console.log("\n=== ULTIMO PERIODO (por orden year/month desc) ===");
        console.log(JSON.stringify(latest, null, 2));

        const desc = `Condominio ${latest.month}/${latest.year}`;
        const issueDate = `${latest.year}-${String(latest.month).padStart(2, "0")}-01`;

        const [receipts] = await db.query(
            `SELECT r.id, a.number as apartment, r.amount, r.paid, r.status, r.description, r.issue_date
             FROM receipts r
             JOIN apartments a ON a.id = r.apartment_id
             WHERE a.building_id = ?
               AND (r.description = ? OR r.issue_date = ?)
             ORDER BY a.number`,
            [latest.building_id, desc, issueDate],
        );
        console.log("\n=== RECIBOS DEL ULTIMO PERIODO ===");
        console.log("Total recibos:", receipts.length);
        console.log(JSON.stringify(receipts, null, 2));

        const receiptIds = receipts.map((r) => r.id);
        if (receiptIds.length) {
            const ph = receiptIds.map(() => "?").join(",");
            const [paymentsLinked] = await db.query(
                `SELECT p.id as payment_id, p.status, p.amount, p.payment_date, p.reference,
                        pr.receipt_id, pr.allocated_amount,
                        a.number as apartment, r.description
                 FROM payment_receipts pr
                 JOIN payments p ON p.id = pr.payment_id
                 JOIN receipts r ON r.id = pr.receipt_id
                 JOIN apartments a ON a.id = p.apartment_id
                 WHERE pr.receipt_id IN (${ph})
                 ORDER BY p.payment_date`,
                receiptIds,
            );
            console.log("\n=== PAGOS VINCULADOS A ESOS RECIBOS ===");
            console.log("Total:", paymentsLinked.length);
            console.log(JSON.stringify(paymentsLinked, null, 2));

            const [allPaymentsBuilding] = await db.query(
                `SELECT p.id, p.status, p.amount, p.payment_date, p.reference, a.number as apartment
                 FROM payments p
                 JOIN apartments a ON a.id = p.apartment_id
                 WHERE a.building_id = ?
                 ORDER BY p.payment_date DESC`,
                [latest.building_id],
            );
            console.log("\n=== TODOS LOS PAGOS DEL EDIFICIO ===");
            console.log("Total:", allPaymentsBuilding.length);
            console.log(JSON.stringify(allPaymentsBuilding, null, 2));

            const [summary] = await db.query(
                `SELECT r.status, COUNT(*) as cnt, SUM(r.amount) as total_amount, SUM(r.paid) as total_paid
                 FROM receipts r
                 JOIN apartments a ON a.id = r.apartment_id
                 WHERE a.building_id = ? AND (r.description = ? OR r.issue_date = ?)
                 GROUP BY r.status`,
                [latest.building_id, desc, issueDate],
            );
            console.log("\n=== RESUMEN ESTATUS RECIBOS ULTIMO PERIODO ===");
            console.log(JSON.stringify(summary, null, 2));
        }

        for (const b of buildings) {
            const [bp] = await db.query(
                "SELECT month, year, closed_at FROM billing_periods WHERE building_id = ? ORDER BY year DESC, month DESC LIMIT 1",
                [b.id],
            );
            if (!bp.length) continue;
            const d = `Condominio ${bp[0].month}/${bp[0].year}`;
            const idate = `${bp[0].year}-${String(bp[0].month).padStart(2, "0")}-01`;
            const [payCount] = await db.query(
                `SELECT COUNT(DISTINCT pr.payment_id) as payments_count
                 FROM receipts r
                 JOIN apartments a ON a.id = r.apartment_id
                 LEFT JOIN payment_receipts pr ON pr.receipt_id = r.id
                 WHERE a.building_id = ? AND (r.description = ? OR r.issue_date = ?)`,
                [b.id, d, idate],
            );
            console.log(
                `\nEdificio ${b.id} (${b.name}) ultimo cierre ${bp[0].month}/${bp[0].year} -> pagos vinculados: ${payCount[0].payments_count}`,
            );
        }

        const [user] = await db.query(
            "SELECT id, name, email, role FROM users WHERE id = ?",
            [adminUserId],
        );
        console.log("\n=== USER 6 ===");
        console.log(JSON.stringify(user, null, 2));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
