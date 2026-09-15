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

    const [buildingN] = await connection.query(
        "SELECT id, name FROM buildings WHERE complex_id = 4 AND id = 55",
    );
    const [apartmentsN] = await connection.query(
        "SELECT number FROM apartments WHERE building_id = 55 ORDER BY number",
    );

    const [binaryMatch] = await connection.query(
        "SELECT id, name FROM buildings WHERE complex_id = 4 AND BINARY name = ?",
        ["Ñ"],
    );

    console.log(
        JSON.stringify(
            {
                buildingN,
                apartmentsNCount: apartmentsN.length,
                apartmentsN: apartmentsN.map((row) => row.number),
                binaryMatchEnye: binaryMatch,
            },
            null,
            2,
        ),
    );

    await connection.end();
})();
