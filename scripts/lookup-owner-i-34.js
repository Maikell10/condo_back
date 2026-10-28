const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../src/db");

(async () => {
    const [rows] = await db.query(
        `SELECT b.name edificio, a.number apt, u.name ownerName, u.email
         FROM apartments a
         JOIN buildings b ON b.id = a.building_id
         LEFT JOIN users u ON u.id = a.owner_id
         WHERE b.complex_id = 4 AND b.name = 'I' AND a.number = '34'`,
    );
    console.log("APARTMENT:", rows);

    const q = "carmen j. gonzalez";
    const name = rows[0]?.ownerName || "";
    console.log("includes test:", name.toLowerCase().includes(q));

    const [receipts] = await db.query(
        `SELECT r.id, r.description, u.name ownerName, a.number apartment
         FROM receipts r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         LEFT JOIN users u ON u.id = a.owner_id
         WHERE b.name = 'I' AND a.number = '34'
         ORDER BY r.issue_date DESC LIMIT 8`,
    );
    console.log("RECEIPTS:", receipts);
    process.exit(0);
})();
