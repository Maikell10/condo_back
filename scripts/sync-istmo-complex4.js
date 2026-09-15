require("dotenv").config();
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const { Readable } = require("stream");

const COMPLEX_ID = 4;
const ADMIN_ID = 1092;
const CSV_PATH = path.join(__dirname, "..", "istmo-import-complex-data.csv");

const parseAlicuota = (rawValue) => {
    if (!rawValue) return null;
    const parsed = Number.parseFloat(String(rawValue).replace(",", "."));
    return Number.isNaN(parsed) ? null : parsed;
};

const readCsv = () =>
    new Promise((resolve, reject) => {
        const rows = [];
        const fileString = fs
            .readFileSync(CSV_PATH, "utf-8")
            .replace(/^\uFEFF/, "");

        Readable.from(fileString)
            .pipe(
                csv({
                    separator: ";",
                    mapHeaders: ({ header }) =>
                        header.trim().replace(/^[\uFEFF\u200B]/g, ""),
                }),
            )
            .on("data", (row) => rows.push(row))
            .on("end", () => resolve(rows))
            .on("error", reject);
    });

const main = async () => {
    const rows = await readCsv();
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    const defaultPassword = await bcrypt.hash("123456", 10);
    const buildingMap = {};

    await connection.beginTransaction();

    try {
        for (const row of rows) {
            const buildingName = row.building_name?.trim();
            const aptNumber = row.apartment?.trim();
            const ownerName = row["Nombre Propietario"]?.trim();
            const alicuota = parseAlicuota(row.alicuota);
            let email = row.email?.trim() || null;
            email = email === "" ? null : email;

            if (!buildingName || !aptNumber) continue;

            if (!buildingMap[buildingName]) {
                const [existingBuilding] = await connection.query(
                    "SELECT id FROM buildings WHERE complex_id = ? AND BINARY name = ?",
                    [COMPLEX_ID, buildingName],
                );

                if (existingBuilding.length > 0) {
                    buildingMap[buildingName] = existingBuilding[0].id;
                } else {
                    const randomHex = crypto
                        .randomBytes(2)
                        .toString("hex")
                        .toUpperCase();
                    const buildingCode = `BLD-${COMPLEX_ID}-${buildingName}-${randomHex}`;
                    const [insertBuilding] = await connection.query(
                        "INSERT INTO buildings (complex_id, admin_id, name, code, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
                        [COMPLEX_ID, ADMIN_ID, buildingName, buildingCode],
                    );
                    buildingMap[buildingName] = insertBuilding.insertId;
                }
            }

            const buildingId = buildingMap[buildingName];
            let ownerId = null;

            if (ownerName) {
                if (email) {
                    const [existingUser] = await connection.query(
                        "SELECT id FROM users WHERE email = ?",
                        [email],
                    );
                    if (existingUser.length > 0) {
                        ownerId = existingUser[0].id;
                    }
                }

                if (!ownerId) {
                    const [existingByName] = await connection.query(
                        `SELECT u.id
                         FROM users u
                         JOIN apartments a ON a.owner_id = u.id
                         JOIN buildings b ON a.building_id = b.id
                         WHERE b.complex_id = ? AND u.name = ? AND u.role = 'OWNER'
                         LIMIT 1`,
                        [COMPLEX_ID, ownerName],
                    );

                    if (existingByName.length > 0) {
                        ownerId = existingByName[0].id;
                    } else {
                        const [insertUser] = await connection.query(
                            "INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, 'OWNER', 'ACTIVE')",
                            [ownerName, email, defaultPassword],
                        );
                        ownerId = insertUser.insertId;
                    }
                }
            }

            const [existingApt] = await connection.query(
                "SELECT id FROM apartments WHERE building_id = ? AND number = ?",
                [buildingId, aptNumber],
            );

            if (existingApt.length === 0) {
                const accessCode = crypto
                    .randomBytes(4)
                    .toString("hex")
                    .toUpperCase();
                await connection.query(
                    "INSERT INTO apartments (building_id, owner_id, number, access_code, alicuota) VALUES (?, ?, ?, ?, ?)",
                    [
                        buildingId,
                        ownerId,
                        aptNumber,
                        accessCode,
                        alicuota ?? 0,
                    ],
                );
            } else {
                await connection.query(
                    "UPDATE apartments SET owner_id = ?, alicuota = ? WHERE id = ?",
                    [ownerId, alicuota ?? 0, existingApt[0].id],
                );
            }
        }

        const [buildings] = await connection.query(
            "SELECT id FROM buildings WHERE complex_id = ?",
            [COMPLEX_ID],
        );

        for (const building of buildings) {
            const [aptCount] = await connection.query(
                "SELECT COUNT(id) AS total FROM apartments WHERE building_id = ?",
                [building.id],
            );
            const total = aptCount[0].total;
            if (!total) continue;

            const equalShare = (1 / total).toFixed(6);
            await connection.query(
                "UPDATE apartments SET alicuota = ? WHERE building_id = ?",
                [equalShare, building.id],
            );
        }

        await connection.commit();

        const [summary] = await connection.query(
            `SELECT b.name, COUNT(a.id) AS aptos, ROUND(SUM(a.alicuota), 6) AS suma
             FROM buildings b
             JOIN apartments a ON a.building_id = b.id
             WHERE b.complex_id = ?
             GROUP BY b.id, b.name
             ORDER BY b.id`,
            [COMPLEX_ID],
        );

        console.log(
            JSON.stringify(
                {
                    message: "Sincronizacion ISTMO completada",
                    buildings: summary.length,
                    apartments: summary.reduce(
                        (total, row) => total + Number(row.aptos),
                        0,
                    ),
                    summary,
                },
                null,
                2,
            ),
        );
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
};

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
