const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

const ISTMO_ADMIN_ID = 1092;

(async () => {
    await db.query(
        `ALTER TABLE admin_settings
         MODIFY expense_split_mode VARCHAR(20) NOT NULL DEFAULT 'BY_BUILDING'`,
    );

    const [others] = await db.query(
        `UPDATE admin_settings
         SET expense_split_mode = 'BY_BUILDING'
         WHERE admin_id <> ?`,
        [ISTMO_ADMIN_ID],
    );

    await db.query(
        `UPDATE admin_settings
         SET expense_split_mode = 'BY_APARTMENT'
         WHERE admin_id = ?`,
        [ISTMO_ADMIN_ID],
    );

    const [rows] = await db.query(
        `SELECT u.email, s.admin_id, s.expense_split_mode
         FROM admin_settings s
         JOIN users u ON u.id = s.admin_id
         ORDER BY s.expense_split_mode, u.email`,
    );

    console.log(JSON.stringify({
        othersUpdated: others.affectedRows,
        modes: rows,
    }, null, 2));
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
