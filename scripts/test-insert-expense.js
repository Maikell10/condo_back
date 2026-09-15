const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [r] = await conn.query(
            `INSERT INTO building_expenses (building_id, concept_id, amount, expense_date)
             VALUES (3, 29, 40, '2026-08-28')`,
        );
        console.log("insert ok", r.insertId);
        await conn.rollback();
        console.log("rolled back test");
    } catch (e) {
        console.error("INSERT ERROR:", e.message, e.code);
        await conn.rollback();
    } finally {
        conn.release();
        process.exit(0);
    }
})();
