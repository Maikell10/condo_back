const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const conn = await db.getConnection();
    try {
        const [before] = await conn.query(
            `SELECT amount FROM receipts r JOIN apartments a ON a.id=r.apartment_id
             WHERE a.building_id=3 AND r.description='Condominio 8/2026' LIMIT 1`,
        );
        console.log("before", before[0]);

        await conn.beginTransaction();
        const [upd] = await conn.query(
            `UPDATE receipts r
             JOIN apartments a ON a.id = r.apartment_id
             SET r.amount = ROUND(r.amount + ?, 2)
             WHERE a.building_id = ? AND r.description = ?`,
            [1, 3, "Condominio 8/2026"],
        );
        console.log("update affected", upd.affectedRows);
        const [after] = await conn.query(
            `SELECT amount FROM receipts r JOIN apartments a ON a.id=r.apartment_id
             WHERE a.building_id=3 AND r.description='Condominio 8/2026' LIMIT 1`,
        );
        console.log("after", after[0]);
        await conn.rollback();
    } catch (e) {
        console.error("ERROR:", e.message);
        await conn.rollback();
    } finally {
        conn.release();
        process.exit(0);
    }
})();
