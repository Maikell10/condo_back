require("dotenv").config();
const mysql = require("mysql2/promise");

(async () => {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: "utf8mb4",
    });

    const [buildings] = await connection.query(
        "SELECT id, name, HEX(name) AS hex FROM buildings WHERE complex_id = 4 ORDER BY id",
    );
    const [[counts]] = await connection.query(
        `SELECT COUNT(DISTINCT b.id) AS buildings, COUNT(a.id) AS apartments
         FROM buildings b
         LEFT JOIN apartments a ON a.building_id = b.id
         WHERE b.complex_id = 4`,
    );

    console.log(JSON.stringify({ counts, buildings }, null, 2));
    await connection.end();
})();
