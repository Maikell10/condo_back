const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const COMPLEX_ID = 4;
const RECEIPT_DESCRIPTION = "Condominio 10/2026";

(async () => {
    const [rows] = await db.query(
        `SELECT
            b.name AS edificio,
            a.number AS apartamento,
            a.access_code,
            r.id AS receipt_id,
            r.amount AS recibo_monto,
            r.paid AS recibo_pagado,
            ROUND(r.amount - r.paid, 2) AS saldo,
            r.status AS estatus_recibo,
            p.id AS payment_id,
            p.status AS estatus_pago,
            p.amount AS monto_pago,
            p.reference AS referencia,
            DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS fecha_pago,
            pr.allocated_amount AS aplicado_a_recibo
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         JOIN payment_receipts pr ON pr.receipt_id = r.id
         JOIN payments p ON p.id = pr.payment_id
         WHERE b.complex_id = ?
           AND r.description = ?
           AND r.paid > 0
         ORDER BY b.name, a.number, p.payment_date`,
        [COMPLEX_ID, RECEIPT_DESCRIPTION],
    );

    console.log("TOTAL REGISTROS (cruces pago-recibo):", rows.length);
    console.log(
        "APARTAMENTOS DISTINTOS:",
        new Set(rows.map((r) => `${r.edificio}-${r.apartamento}`)).size,
    );
    console.log(JSON.stringify(rows, null, 2));

    const [byApt] = await db.query(
        `SELECT
            b.name AS edificio,
            a.number AS apartamento,
            a.access_code,
            r.amount AS recibo_monto,
            r.paid AS recibo_pagado,
            ROUND(r.amount - r.paid, 2) AS saldo,
            r.status AS estatus_recibo
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         WHERE b.complex_id = ?
           AND r.description = ?
           AND r.paid > 0
         ORDER BY b.name, a.number`,
        [COMPLEX_ID, RECEIPT_DESCRIPTION],
    );
    console.log("\n=== LISTADO POR APARTAMENTO (para validar) ===");
    console.log(JSON.stringify(byApt, null, 2));

    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
