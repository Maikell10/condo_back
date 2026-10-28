const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const [rows] = await db.query(
        `SELECT b.name,
            SUM(CASE WHEN r.paid > 0 THEN 1 ELSE 0 END) as with_payment
         FROM buildings b
         JOIN apartments a ON a.building_id = b.id
         LEFT JOIN receipts r ON r.apartment_id = a.id AND r.description = 'Condominio 10/2026'
         WHERE b.complex_id = 4
         GROUP BY b.id, b.name
         HAVING with_payment > 0
         ORDER BY b.name`,
    );
    console.log("Edificios CON pagos en recibos Oct/2026:", rows.length);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
})();
