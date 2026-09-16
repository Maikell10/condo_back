const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const [rows] = await db.query(
        `SELECT b.name, COUNT(*) AS n, ROUND(SUM(c.monthly_amount), 2) AS monthly
         FROM contracts c
         JOIN buildings b ON b.id = c.building_id
         WHERE b.complex_id = 4 AND c.is_active = 1
         GROUP BY b.id, b.name
         ORDER BY b.name`,
    );
    const [complexContracts] = await db.query(
        `SELECT id, provider, monthly_amount, complex_id, building_id
         FROM contracts WHERE complex_id = 4 AND is_active = 1`,
    );
    console.log(JSON.stringify({ byBuilding: rows, complexLevel: complexContracts }, null, 2));
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
