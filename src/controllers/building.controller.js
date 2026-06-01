const db = require("../db"); // Subimos un nivel para encontrar db.js
const csv = require("csv-parser");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { Readable } = require("stream");

const getBuildingsByComplex = async (req, res) => {
    // Tomamos el ID del admin desde el token que ya pasó por el middleware
    const adminId = req.user.id;

    try {
        // Reutilizamos la lógica infalible: Traer edificios suyos o de su conjunto
        const [buildings] = await db.query(
            `SELECT b.id, b.name, b.code
             FROM buildings b 
             LEFT JOIN residential_complexes rc ON b.complex_id = rc.id 
             WHERE (b.admin_id = ? OR rc.admin_id = ?) AND b.status = 'ACTIVE'`,
            [adminId, adminId],
        );

        res.json({
            message: "Edificios recuperados exitosamente",
            data: buildings, // Esto enviará un Array con Indiana y Paraíso
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al obtener los edificios." });
    }
};

const importComplexData = async (req, res) => {
    // ⚠️ IMPORTANTE: Asegúrate de que el ID 2 exista en la tabla 'residential_complexes'
    const complexId = 2;

    if (!req.file) {
        return res
            .status(400)
            .json({ message: "No se proporcionó ningún archivo." });
    }

    const results = [];

    // 🔥 FIX MÁGICO 1: Convertimos explícitamente los bytes a Texto UTF-8
    const fileString = req.file.buffer.toString("utf-8");

    Readable.from(fileString)
        .pipe(
            csv({
                separator: ";", // El separador de tu archivo
                // 🔥 FIX MÁGICO 2: Limpiamos espacios y caracteres ocultos de Excel en los títulos
                mapHeaders: ({ header }) =>
                    header.trim().replace(/^[\uFEFF\u200B]/g, ""),
            }),
        )
        .on("data", (data) => results.push(data))
        .on("end", async () => {
            // Si después de leer, el arreglo está vacío, avisamos el error real.
            if (results.length === 0) {
                return res
                    .status(400)
                    .json({
                        message:
                            "El archivo se procesó pero no se encontraron filas o los títulos de las columnas no coinciden.",
                    });
            }

            const connection = await db.getConnection();

            try {
                await connection.beginTransaction();
                const defaultPassword = await bcrypt.hash("123456", 10);
                const buildingMap = {};

                for (const row of results) {
                    const buildingName = row["building_name"]?.trim();
                    const aptNumber = row["apartment"]?.trim();
                    const ownerName = row["Nombre Propietario"]?.trim();

                    // Asegurar que si el correo está vacío, sea NULL para la BD
                    let email = row["email"]?.trim();
                    email = email === "" || email === undefined ? null : email;

                    if (!buildingName || !aptNumber) continue;

                    // ==============================
                    // 1. EDIFICIOS
                    // ==============================
                    if (!buildingMap[buildingName]) {
                        const randomHex = crypto
                            .randomBytes(2)
                            .toString("hex")
                            .toUpperCase();
                        const buildingCode = `BLD-${complexId}-${buildingName}-${randomHex}`;

                        const [bResult] = await connection.query(
                            `INSERT INTO buildings (complex_id, name, code, status) VALUES (?, ?, ?, 'ACTIVE')`,
                            [complexId, buildingName, buildingCode],
                        );
                        buildingMap[buildingName] = bResult.insertId;
                    }
                    const currentBuildingId = buildingMap[buildingName];

                    // ==============================
                    // 2. PROPIETARIOS
                    // ==============================
                    let ownerId = null;
                    if (ownerName) {
                        if (email) {
                            const [existingUser] = await connection.query(
                                `SELECT id FROM users WHERE email = ?`,
                                [email],
                            );
                            if (existingUser.length > 0) {
                                ownerId = existingUser[0].id;
                            }
                        }
                        if (!ownerId) {
                            const [uResult] = await connection.query(
                                `INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, 'OWNER', 'ACTIVE')`,
                                [ownerName, email, defaultPassword],
                            );
                            ownerId = uResult.insertId;
                        }
                    }

                    // ==============================
                    // 3. APARTAMENTOS
                    // ==============================
                    const accessCode = crypto
                        .randomBytes(4)
                        .toString("hex")
                        .toUpperCase();
                    await connection.query(
                        `INSERT INTO apartments (building_id, owner_id, number, access_code, alicuota) VALUES (?, ?, ?, ?, 0)`,
                        [currentBuildingId, ownerId, aptNumber, accessCode],
                    );
                }

                // ==============================
                // 4. CALCULAR ALÍCUOTAS POR EDIFICIO
                // ==============================
                const buildingIds = Object.values(buildingMap);

                for (const bId of buildingIds) {
                    const [aptCountRes] = await connection.query(
                        `SELECT COUNT(id) as total FROM apartments WHERE building_id = ?`,
                        [bId],
                    );
                    const totalApts = aptCountRes[0].total;

                    if (totalApts > 0) {
                        const alicuotaEquitativa = (1 / totalApts).toFixed(6);
                        await connection.query(
                            `UPDATE apartments SET alicuota = ? WHERE building_id = ?`,
                            [alicuotaEquitativa, bId],
                        );
                    }
                }

                await connection.commit();

                res.status(201).json({
                    message:
                        "Data importada y alícuotas divididas en partes iguales.",
                    edificiosCreados: buildingIds.length,
                });
            } catch (error) {
                await connection.rollback();
                console.error("Error importando datos:", error);

                // 🔥 FIX MÁGICO 3: Si hay un error de SQL (Ej: Llave foránea), lo mandamos al FrontEnd para que lo veas.
                res.status(500).json({
                    message: "Error SQL: " + error.message,
                });
            } finally {
                connection.release();
            }
        });
};

module.exports = {
    // ... tus otras exportaciones
    getBuildingsByComplex,
    importComplexData,
};
