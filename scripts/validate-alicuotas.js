require("dotenv").config();
const mysql = require("mysql2/promise");

const TOLERANCE = 0.0001;
const COMPLEX_IDS = [2, 3, 4];

(async () => {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    for (const complexId of COMPLEX_IDS) {
        const [[complex]] = await connection.query(
            "SELECT id, name FROM residential_complexes WHERE id = ?",
            [complexId],
        );

        const [rows] = await connection.query(
            `SELECT b.id, b.name, COUNT(a.id) AS aptos,
                    ROUND(SUM(a.alicuota), 6) AS suma,
                    ROUND(1 - SUM(a.alicuota), 6) AS diff
             FROM buildings b
             JOIN apartments a ON a.building_id = b.id
             WHERE b.complex_id = ?
             GROUP BY b.id, b.name
             ORDER BY b.id`,
            [complexId],
        );

        const [[complexTotal]] = await connection.query(
            `SELECT COUNT(a.id) AS aptos, ROUND(SUM(a.alicuota), 6) AS total
             FROM apartments a
             JOIN buildings b ON a.building_id = b.id
             WHERE b.complex_id = ?`,
            [complexId],
        );

        const failures = rows.filter(
            (row) => Math.abs(Number(row.suma) - 1) > TOLERANCE,
        );

        console.log("=".repeat(72));
        console.log(
            `COMPLEX ${complexId}: ${complex ? complex.name : "NO EXISTE"}`,
        );
        console.log(
            `Edificios: ${rows.length} | OK: ${rows.length - failures.length} | FAIL: ${failures.length}`,
        );
        console.log(
            `Apartamentos: ${complexTotal.aptos} | Suma total alicuotas: ${complexTotal.total}`,
        );
        console.log("");

        if (rows.length === 0) {
            console.log("  (sin edificios/apartamentos)");
            console.log("");
            continue;
        }

        for (const row of rows) {
            const ok = Math.abs(Number(row.suma) - 1) <= TOLERANCE;
            console.log(
                `${ok ? "OK  " : "FAIL"} | id ${String(row.id).padStart(2)} | ${String(row.name).padEnd(12)} | apts ${String(row.aptos).padStart(2)} | suma ${row.suma} | diff ${row.diff}`,
            );
        }
        console.log("");
    }

    await connection.end();
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
