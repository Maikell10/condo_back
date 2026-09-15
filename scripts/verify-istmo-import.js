require("dotenv").config();
const mysql = require("mysql2/promise");

(async () => {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    const [buildings] = await connection.query(
        "SELECT id, name FROM buildings WHERE complex_id = 4 ORDER BY id",
    );
    const [[apartments]] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM apartments a
         JOIN buildings b ON a.building_id = b.id
         WHERE b.complex_id = 4`,
    );
    const [[withoutOwner]] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM apartments a
         JOIN buildings b ON a.building_id = b.id
         WHERE b.complex_id = 4 AND a.owner_id IS NULL`,
    );
    const [[withOwner]] = await connection.query(
        `SELECT COUNT(DISTINCT a.owner_id) AS total
         FROM apartments a
         JOIN buildings b ON a.building_id = b.id
         WHERE b.complex_id = 4 AND a.owner_id IS NOT NULL`,
    );
    const [noOwnerList] = await connection.query(
        `SELECT b.name AS building, a.number AS apartment
         FROM apartments a
         JOIN buildings b ON a.building_id = b.id
         WHERE b.complex_id = 4 AND a.owner_id IS NULL
         ORDER BY b.name, a.number`,
    );
    const [buildingA] = await connection.query(
        `SELECT a.number, a.alicuota, u.name AS owner
         FROM apartments a
         JOIN buildings b ON a.building_id = b.id
         LEFT JOIN users u ON a.owner_id = u.id
         WHERE b.complex_id = 4 AND b.name = 'A'
         ORDER BY a.number`,
    );

    console.log(
        JSON.stringify(
            {
                buildings: buildings.length,
                firstBuilding: buildings[0],
                lastBuilding: buildings[buildings.length - 1],
                apartments: apartments.total,
                ownersCreated: withOwner.total,
                apartmentsWithoutOwner: withoutOwner.total,
                noOwnerList: noOwnerList.map(
                    (row) => `${row.building}-${row.apartment}`,
                ),
                buildingA,
            },
            null,
            2,
        ),
    );

    await connection.end();
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
