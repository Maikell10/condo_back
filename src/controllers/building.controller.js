const db = require("../db"); // Subimos un nivel para encontrar db.js
const fs = require("fs");
const csv = require("csv-parser");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

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
    // El ID del conjunto residencial objetivo
    const complexId = 2;

    // Verificamos si multer interceptó el archivo (ej. form-data con campo 'file')
    if (!req.file) {
        return res
            .status(400)
            .json({ message: "No se proporcionó ningún archivo CSV." });
    }

    const results = [];

    // 1. Leer y parsear el archivo CSV
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", async () => {
            // Obtenemos una conexión exclusiva para la Transacción
            const connection = await db.getConnection();

            try {
                // INICIAMOS TRANSACCIÓN
                await connection.beginTransaction();

                // Contraseña por defecto para todos los propietarios importados
                const defaultPassword = await bcrypt.hash("123456", 10);

                // Diccionario para guardar en memoria los edificios que vamos creando y no repetirlos
                // Se verá así: { '1A': 5, '1B': 6, ... }
                const buildingMap = {};

                for (const row of results) {
                    // Extraemos las columnas exactas de tu archivo CSV
                    const buildingName = row["building_name"]?.trim();
                    const aptNumber = row["apartment"]?.trim();
                    const ownerName = row["Nombre Propietario"]?.trim();
                    let email = row["email"]?.trim() || null; // Si está vacío, enviamos null a MySQL

                    const rawAlicuota = row["alicuota"]?.trim();
                    const alicuota = rawAlicuota
                        ? parseFloat(rawAlicuota)
                        : 0.0;

                    // Si la fila está vacía, la saltamos
                    if (!buildingName || !aptNumber) continue;

                    // ============================================
                    // PASO 2: CREACIÓN DE EDIFICIOS ÚNICOS
                    // ============================================
                    if (!buildingMap[buildingName]) {
                        // Generamos un código único para el edificio (Ej: BLD-2-1A-F3A1)
                        const randomHex = crypto
                            .randomBytes(2)
                            .toString("hex")
                            .toUpperCase();
                        const buildingCode = `BLD-${complexId}-${buildingName}-${randomHex}`;

                        const [bResult] = await connection.query(
                            `INSERT INTO buildings (complex_id, name, code, status) VALUES (?, ?, ?, 'ACTIVE')`,
                            [complexId, buildingName, buildingCode],
                        );
                        // Guardamos el ID insertado en nuestro diccionario
                        buildingMap[buildingName] = bResult.insertId;
                    }

                    const currentBuildingId = buildingMap[buildingName];

                    // ============================================
                    // PASO 3: CREACIÓN DE USUARIO (PROPIETARIO)
                    // ============================================
                    let ownerId = null;

                    if (ownerName) {
                        // Si nos pasaron email en el CSV, verificamos que no exista previamente
                        if (email) {
                            const [existingUser] = await connection.query(
                                `SELECT id FROM users WHERE email = ?`,
                                [email],
                            );
                            if (existingUser.length > 0) {
                                ownerId = existingUser[0].id; // Si ya existe, reciclamos su ID
                            }
                        }

                        // Si no lo encontramos o no tenía email, lo creamos nuevo
                        if (!ownerId) {
                            const [uResult] = await connection.query(
                                `INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, 'OWNER', 'ACTIVE')`,
                                [ownerName, email, defaultPassword],
                            );
                            ownerId = uResult.insertId;
                        }
                    }

                    // ============================================
                    // PASO 4: CREACIÓN DEL APARTAMENTO
                    // ============================================
                    // Generamos el access_code de 8 caracteres requerido por tu BD
                    const accessCode = crypto
                        .randomBytes(4)
                        .toString("hex")
                        .toUpperCase();

                    await connection.query(
                        `INSERT INTO apartments (building_id, owner_id, number, access_code, alicuota) VALUES (?, ?, ?, ?, ?)`,
                        [
                            currentBuildingId,
                            ownerId,
                            aptNumber,
                            accessCode,
                            alicuota,
                        ],
                    );
                }

                // SI TODO SALIÓ BIEN, CONFIRMAMOS LA TRANSACCIÓN
                await connection.commit();

                res.status(201).json({
                    message: "Data importada exitosamente.",
                    edificiosCreados: Object.keys(buildingMap).length,
                });
            } catch (error) {
                // SI ALGO FALLÓ, REVERTIMOS TODO (No se guarda nada a la mitad)
                await connection.rollback();
                console.error("Error importando datos:", error);
                res.status(500).json({
                    message: "Error crítico al importar los datos.",
                });
            } finally {
                // Siempre soltamos la conexión para no saturar la BD
                connection.release();

                // Borramos el archivo CSV temporal del servidor
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
            }
        });
};

module.exports = {
    // ... tus otras exportaciones
    getBuildingsByComplex,
    importComplexData,
};
