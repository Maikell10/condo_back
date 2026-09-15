require("dotenv").config();
const mysql = require("mysql2/promise");
const crypto = require("crypto");

(async () => {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: "utf8mb4",
    });

    const buildingName = "Ñ";
    const [existing] = await connection.query(
        "SELECT id, name, HEX(name) AS hex FROM buildings WHERE complex_id = 4 AND name = ?",
        [buildingName],
    );
    console.log("existing", existing);

    if (existing.length === 0) {
        const randomHex = crypto.randomBytes(2).toString("hex").toUpperCase();
        const [result] = await connection.query(
            "INSERT INTO buildings (complex_id, admin_id, name, code, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
            [4, 1092, buildingName, `BLD-4-${buildingName}-${randomHex}`],
        );
        console.log("inserted building id", result.insertId);
    }

    await connection.end();
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
