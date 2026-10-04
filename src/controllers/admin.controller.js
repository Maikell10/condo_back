const db = require("../db");
const bcrypt = require("bcryptjs");
const csv = require("csv-parser");
const crypto = require("crypto");
const fs = require("fs");

const USER_SCOPE_SQL = `
    CASE
        WHEN u.role = 'BUILDING_ADMIN' THEN COALESCE(
            (SELECT rc.name FROM residential_complexes rc WHERE rc.admin_id = u.id ORDER BY rc.id LIMIT 1),
            (SELECT b.name FROM buildings b WHERE b.admin_id = u.id ORDER BY b.id LIMIT 1),
            'Sin asignar'
        )
        WHEN u.role = 'OWNER' THEN COALESCE(
            (SELECT GROUP_CONCAT(DISTINCT b.name ORDER BY b.name SEPARATOR ', ')
             FROM apartments a
             INNER JOIN buildings b ON b.id = a.building_id
             WHERE a.owner_id = u.id),
            'Sin unidad'
        )
        ELSE 'Sistema Central'
    END`;

const buildUsersListFilters = (query) => {
    const conditions = ["1 = 1"];
    const params = [];

    const status = query.status || "ALL";
    const role = query.role || "ALL";
    const search = query.search ? String(query.search).trim() : "";

    if (status !== "ALL") {
        conditions.push("u.status = ?");
        params.push(status);
    }
    if (role !== "ALL") {
        conditions.push("u.role = ?");
        params.push(role);
    }
    if (search) {
        conditions.push("(u.name LIKE ? OR u.email LIKE ?)");
        const term = `%${search}%`;
        params.push(term, term);
    }

    return { where: conditions.join(" AND "), params };
};

/** Listado paginado de usuarios (escala ~ miles de filas). */
const getAllUsers = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(
            100,
            Math.max(5, parseInt(req.query.limit, 10) || 25),
        );
        const offset = (page - 1) * limit;

        const { where, params } = buildUsersListFilters(req.query);

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM users u WHERE ${where}`,
            params,
        );

        const [[statsRow]] = await db.query(
            `SELECT
                COUNT(*) AS total,
                SUM(u.status = 'ACTIVE') AS active,
                SUM(u.status = 'INACTIVE') AS inactive,
                SUM(u.role = 'SUPER_ADMIN') AS superAdmins,
                SUM(u.role = 'BUILDING_ADMIN') AS buildingAdmins,
                SUM(u.role = 'OWNER') AS owners
             FROM users u
             WHERE ${where}`,
            params,
        );

        const [users] = await db.query(
            `SELECT
                u.id,
                u.name,
                u.email,
                u.role,
                u.status,
                ${USER_SCOPE_SQL} AS buildingName
             FROM users u
             WHERE ${where}
             ORDER BY u.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset],
        );

        const totalNum = Number(total) || 0;

        res.json({
            data: users,
            meta: {
                page,
                limit,
                total: totalNum,
                totalPages: totalNum ? Math.ceil(totalNum / limit) : 0,
            },
            stats: {
                total: Number(statsRow.total) || 0,
                active: Number(statsRow.active) || 0,
                inactive: Number(statsRow.inactive) || 0,
                superAdmins: Number(statsRow.superAdmins) || 0,
                buildingAdmins: Number(statsRow.buildingAdmins) || 0,
                owners: Number(statsRow.owners) || 0,
            },
        });
    } catch (error) {
        console.error("getAllUsers:", error);
        res.status(500).json({
            message: "Error al obtener usuarios",
        });
    }
};

// Alternar estado del usuario (ACTIVE/INACTIVE)
const toggleUserStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'ACTIVE' o 'INACTIVE'
    try {
        await db.query("UPDATE users SET status = ? WHERE id = ?", [
            status,
            id,
        ]);
        res.json({ message: "Estado actualizado correctamente" });
    } catch (error) {
        res.status(500).json({ message: "Error al actualizar estado" });
    }
};

const createUser = async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
        return res
            .status(400)
            .json({ message: "Todos los campos son obligatorios" });
    }

    try {
        // Encriptar la contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const query = `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`;
        const [result] = await db.query(query, [
            name,
            email,
            hashedPassword,
            role,
        ]);

        res.status(201).json({ message: "Usuario registrado exitosamente" });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res
                .status(400)
                .json({ message: "El correo electrónico ya está registrado" });
        }
        console.error(error);
        res.status(500).json({ message: "Error al crear el usuario" });
    }
};

const updateUser = async (req, res) => {
    const { id } = req.params;
    const { name, email, role } = req.body; // No recibimos password aquí por seguridad

    if (!name || !email || !role) {
        return res
            .status(400)
            .json({ message: "Nombre, email y rol son obligatorios" });
    }

    try {
        const query = `UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?`;
        const [result] = await db.query(query, [name, email, role, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }
        res.json({ message: "Usuario actualizado correctamente" });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                message:
                    "El correo electrónico ya está en uso por otro usuario",
            });
        }
        res.status(500).json({ message: "Error al actualizar el usuario" });
    }
};

const getBuildings = async (req, res) => {
    try {
        const { search, status, complexId } = req.query;
        const conditions = ["1 = 1"];
        const params = [];

        if (status && status !== "ALL") {
            conditions.push("b.status = ?");
            params.push(status);
        }

        if (complexId === "none") {
            conditions.push("b.complex_id IS NULL");
        } else if (complexId && complexId !== "ALL") {
            conditions.push("b.complex_id = ?");
            params.push(Number(complexId));
        }

        if (search && String(search).trim()) {
            const term = `%${String(search).trim()}%`;
            conditions.push(
                "(b.name LIKE ? OR b.code LIKE ? OR b.address LIKE ? OR u.email LIKE ? OR u.name LIKE ? OR rc.name LIKE ? OR rc.direccion LIKE ?)",
            );
            params.push(term, term, term, term, term, term, term);
        }

        const query = `
            SELECT 
                b.id,
                b.code,
                b.name,
                b.status,
                b.address,
                b.complex_id AS complexId,
                COALESCE(u.email, cu.email) AS adminEmail,
                COALESCE(u.name, cu.name) AS adminName,
                CASE
                    WHEN b.admin_id IS NOT NULL THEN u.status
                    WHEN rc.admin_id IS NOT NULL THEN cu.status
                    ELSE NULL
                END AS adminStatus,
                rc.name AS complexName,
                rc.direccion AS complexAddress,
                COALESCE(apt_counts.totalApartments, 0) AS totalApartments
            FROM buildings b
            LEFT JOIN users u ON b.admin_id = u.id
            LEFT JOIN residential_complexes rc ON b.complex_id = rc.id
            LEFT JOIN users cu ON rc.admin_id = cu.id
            LEFT JOIN (
                SELECT building_id, COUNT(*) AS totalApartments
                FROM apartments
                GROUP BY building_id
            ) apt_counts ON apt_counts.building_id = b.id
            WHERE ${conditions.join(" AND ")}
            ORDER BY 
                CASE WHEN rc.name IS NULL THEN 1 ELSE 0 END,
                rc.name ASC,
                b.name ASC
        `;

        const [buildings] = await db.query(query, params);

        const complexMap = new Map();
        for (const row of buildings) {
            if (row.complexId == null) continue;
            if (!complexMap.has(row.complexId)) {
                complexMap.set(row.complexId, {
                    id: row.complexId,
                    name: row.complexName,
                    address: row.complexAddress,
                    buildingCount: 0,
                });
            }
            complexMap.get(row.complexId).buildingCount += 1;
        }

        res.json({
            data: buildings,
            complexes: Array.from(complexMap.values()).sort((a, b) =>
                String(a.name || "").localeCompare(String(b.name || "")),
            ),
        });
    } catch (error) {
        console.error("getBuildings:", error);
        res.status(500).json({ message: "Error al obtener los edificios" });
    }
};

const toggleBuildingStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.query("UPDATE buildings SET status = ? WHERE id = ?", [
            status,
            id,
        ]);
        res.json({ message: "Estado del edificio actualizado" });
    } catch (error) {
        res.status(500).json({ message: "Error al cambiar estado" });
    }
};

/** Suspende o activa todos los edificios del conjunto y sus administradores (conjunto + por edificio). */
const setComplexStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (status !== "ACTIVE" && status !== "INACTIVE") {
        return res.status(400).json({
            message: "Estado inválido. Use ACTIVE o INACTIVE.",
        });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [[complex]] = await connection.query(
            "SELECT id, admin_id FROM residential_complexes WHERE id = ?",
            [id],
        );
        if (!complex) {
            await connection.rollback();
            return res.status(404).json({ message: "Conjunto no encontrado" });
        }

        const [buildingResult] = await connection.query(
            "UPDATE buildings SET status = ? WHERE complex_id = ?",
            [status, id],
        );

        try {
            await connection.query(
                "UPDATE residential_complexes SET status = ? WHERE id = ?",
                [status, id],
            );
        } catch (complexStatusErr) {
            if (complexStatusErr.code !== "ER_BAD_FIELD_ERROR") {
                throw complexStatusErr;
            }
        }

        const adminIds = new Set();
        if (complex.admin_id) {
            adminIds.add(complex.admin_id);
        }
        const [buildingAdmins] = await connection.query(
            "SELECT DISTINCT admin_id FROM buildings WHERE complex_id = ? AND admin_id IS NOT NULL",
            [id],
        );
        for (const row of buildingAdmins) {
            if (row.admin_id) {
                adminIds.add(row.admin_id);
            }
        }

        let adminsUpdated = 0;
        for (const adminId of adminIds) {
            const [userResult] = await connection.query(
                "UPDATE users SET status = ? WHERE id = ? AND role = 'BUILDING_ADMIN'",
                [status, adminId],
            );
            adminsUpdated += userResult.affectedRows;
        }

        await connection.commit();

        const verb =
            status === "ACTIVE" ? "activado" : "suspendido";
        res.json({
            message: `Conjunto ${verb}: ${buildingResult.affectedRows} edificio(s) y ${adminsUpdated} administrador(es).`,
            data: {
                complexId: Number(id),
                status,
                buildingsUpdated: buildingResult.affectedRows,
                adminsUpdated,
            },
        });
    } catch (error) {
        await connection.rollback();
        console.error("setComplexStatus:", error);
        res.status(500).json({
            message: "Error al actualizar el estado del conjunto",
        });
    } finally {
        connection.release();
    }
};

// Crear un nuevo edificio
const createBuilding = async (req, res) => {
    const { name, code, address } = req.body;

    if (!name || !code) {
        return res
            .status(400)
            .json({ message: "El nombre y el código son obligatorios" });
    }

    try {
        const query = `INSERT INTO buildings (name, code, address) VALUES (?, ?, ?)`;
        const [result] = await db.query(query, [name, code, address || null]);

        res.status(201).json({
            message: "Edificio creado exitosamente",
            data: { id: result.insertId, name, code, address },
        });
    } catch (error) {
        // Manejo específico si el código ya existe (ER_DUP_ENTRY en MySQL)
        if (error.code === "ER_DUP_ENTRY") {
            return res
                .status(400)
                .json({ message: "Ya existe un edificio con ese código" });
        }
        console.error("Error al crear edificio:", error);
        res.status(500).json({ message: "Error interno al crear el edificio" });
    }
};

// Editar un edificio existente
const updateBuilding = async (req, res) => {
    const { id } = req.params;
    const { name, code, address } = req.body;

    if (!name || !code) {
        return res
            .status(400)
            .json({ message: "El nombre y el código son obligatorios" });
    }

    try {
        const query = `UPDATE buildings SET name = ?, code = ?, address = ? WHERE id = ?`;
        const [result] = await db.query(query, [
            name,
            code,
            address || null,
            id,
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Edificio no encontrado" });
        }

        res.json({ message: "Edificio actualizado exitosamente" });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res
                .status(400)
                .json({ message: "Ya existe otro edificio con ese código" });
        }
        console.error("Error al actualizar edificio:", error);
        res.status(500).json({
            message: "Error interno al actualizar el edificio",
        });
    }
};

const assignBuildingAdmin = async (req, res) => {
    const { id } = req.params; // ID del edificio
    const { email } = req.body; // Correo del usuario a asignar

    if (!email) {
        return res
            .status(400)
            .json({ message: "El correo del usuario es obligatorio" });
    }

    try {
        // 1. Buscar si el usuario existe
        const [users] = await db.query("SELECT * FROM users WHERE email = ?", [
            email,
        ]);
        if (users.length === 0) {
            return res.status(404).json({
                message:
                    "No existe ningún usuario con este correo. Regístrelo primero en la sección de Usuarios.",
            });
        }

        const user = users[0];

        // 2. Validar que no tenga un rol conflictivo
        if (user.role === "SUPER_ADMIN" || user.role === "OWNER") {
            return res.status(400).json({
                message: `El usuario tiene rol de ${user.role}. Solo usuarios con rol BUILDING_ADMIN pueden ser asignados.`,
            });
        }

        // 3. Validar que no esté administrando YA otro edificio
        const [existingBuildings] = await db.query(
            "SELECT name FROM buildings WHERE admin_id = ? AND id != ?",
            [user.id, id],
        );
        if (existingBuildings.length > 0) {
            return res.status(400).json({
                message: `Este usuario ya es administrador de: ${existingBuildings[0].name}`,
            });
        }

        // 4. Asignar el administrador al edificio y asegurar su rol
        await db.query(
            "UPDATE users SET role = 'BUILDING_ADMIN' WHERE id = ?",
            [user.id],
        );
        await db.query("UPDATE buildings SET admin_id = ? WHERE id = ?", [
            user.id,
            id,
        ]);

        res.json({ message: "Administrador asignado correctamente" });
    } catch (error) {
        console.error("Error al asignar admin:", error);
        res.status(500).json({
            message: "Error interno al asignar el administrador",
        });
    }
};

// Obtener estadísticas globales para el Dashboard del Superadmin
const getDashboardStats = async (req, res) => {
    try {
        // 1. Ejecutamos todas las consultas en paralelo para mayor velocidad
        const [
            [[{ totalBuildings }]],
            [[{ activeUsers }]],
            [attentionRequired],
            [recentActivity],
        ] = await Promise.all([
            // Total de edificios
            db.query("SELECT COUNT(*) as totalBuildings FROM buildings"),

            // Total de usuarios activos
            db.query(
                "SELECT COUNT(*) as activeUsers FROM users WHERE status = 'ACTIVE'",
            ),

            // Alertas: Edificios sin administrador (Requieren atención)
            db.query(`
                SELECT name, 'Sin Administrador asignado' as issue, 'high' as severity 
                FROM buildings 
                WHERE admin_id IS NULL
                LIMIT 5
            `),

            // Actividad Reciente: Por ahora mostraremos los últimos edificios y usuarios creados
            // Nota: En el futuro, lo ideal es crear una tabla 'audit_logs'
            db.query(`
                SELECT 
                    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as time, 
                    'Sistema' as user, 
                    'Nuevo edificio registrado' as action, 
                    name as target, 
                    'CREATE' as type 
                FROM buildings 
                ORDER BY created_at DESC 
                LIMIT 5
            `),
        ]);

        // 2. Ensamblamos la respuesta exacta que Angular espera
        res.json({
            metrics: {
                totalBuildings: totalBuildings || 0,
                activeUsers: activeUsers || 0,
                monthlyRevenue: 0, // TODO: Conectar a SELECT SUM(amount) FROM payments WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
                activeIncidents: 0, // TODO: Conectar a SELECT COUNT(*) FROM incidents WHERE status = 'OPEN'
            },
            attentionRequired,
            recentActivity,
        });
    } catch (error) {
        console.error("Error al cargar dashboard:", error);
        res.status(500).json({
            message: "Error interno al cargar las métricas del sistema",
        });
    }
};

//-----------------------------------------------------------------------------
const csvFilePath = "subir conjunto 2.csv";
async function importData() {
    const results = [];

    // Leer el archivo CSV (Usando separator ';' y latin1 por el formato del archivo)
    fs.createReadStream(csvFilePath, { encoding: "latin1" })
        .pipe(csv({ separator: ";" }))
        .on("data", (data) => results.push(data))
        .on("end", async () => {
            console.log(
                `CSV leído con éxito. Se procesarán ${results.length} filas.`,
            );
            await processRows(results);
        });
}

async function processRows(rows) {
    let successCount = 0;
    let errorCount = 0;

    // Asignamos la fecha de hoy a todos los recibos de deuda histórica
    const issueDate = new Date().toISOString().split("T")[0];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Asumiendo que la nueva columna en tu CSV se llama 'deuda'
        const {
            building_id,
            number,
            alicuota,
            name_user,
            email,
            password,
            role,
            deuda,
        } = row;

        try {
            // --- 1. INSERTAR O BUSCAR USUARIO ---
            let userId = null;
            let cleanEmail = email ? String(email).trim() : "";

            // Solo buscamos si realmente escribieron un correo en el CSV
            if (cleanEmail !== "") {
                const [existingUsers] = await db.query(
                    "SELECT id FROM users WHERE email = ?",
                    [cleanEmail],
                );

                if (existingUsers.length > 0) {
                    userId = existingUsers[0].id;
                    console.log(
                        `[Fila ${i + 1}] Usuario existente: ${cleanEmail} (ID: ${userId})`,
                    );
                }
            }

            // Si no se encontró el usuario, o si no tenía correo en el CSV, creamos uno nuevo
            if (!userId) {
                // Si venía vacío, inventamos un correo temporal para evitar el error de "Duplicate Entry" en MySQL
                if (cleanEmail === "") {
                    // Ej: sin-correo-1-101@condominio.local
                    cleanEmail = `sin-correo-${building_id}-${number}@condominio.local`;
                }

                const [userResult] = await db.query(
                    'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, "ACTIVE")',
                    [name_user, cleanEmail, password, role || "OWNER"],
                );
                userId = userResult.insertId;
                console.log(
                    `[Fila ${i + 1}] Nuevo usuario creado: ${cleanEmail} (ID: ${userId})`,
                );
            }

            // Verificar si el email ya existe para evitar errores de duplicidad
            const [existingUsers] = await db.query(
                "SELECT id FROM users WHERE email = ?",
                [cleanEmail],
            );

            if (existingUsers.length > 0) {
                userId = existingUsers[0].id;
                console.log(
                    `[Fila ${i + 1}] Usuario existente: ${cleanEmail} (ID: ${userId})`,
                );
            } else {
                const [userResult] = await db.query(
                    'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, "ACTIVE")',
                    [name_user, cleanEmail, password, role || "OWNER"],
                );
                userId = userResult.insertId;
                console.log(
                    `[Fila ${i + 1}] Nuevo usuario creado: ${cleanEmail} (ID: ${userId})`,
                );
            }

            // --- 2. INSERTAR APARTAMENTO ---
            const accessCode = crypto
                .randomBytes(4)
                .toString("hex")
                .toUpperCase();
            const alicuotaParsed = parseFloat(
                String(alicuota).replace(",", "."),
            );

            const [aptResult] = await db.query(
                "INSERT INTO apartments (building_id, owner_id, number, access_code, alicuota) VALUES (?, ?, ?, ?, ?)",
                [building_id, userId, number, accessCode, alicuotaParsed],
            );

            const apartmentId = aptResult.insertId;
            console.log(
                `[Fila ${i + 1}] ✅ Apartamento ${number} creado con ID ${apartmentId} y código ${accessCode}`,
            );

            // --- 3. PROCESAR DEUDA HISTÓRICA ---
            if (deuda && String(deuda).trim() !== "") {
                const amount = parseFloat(String(deuda).replace(",", "."));

                if (!isNaN(amount) && amount > 0) {
                    await db.query(
                        `INSERT INTO receipts 
                        (apartment_id, amount, paid, status, description, issue_date, type) 
                        VALUES (?, ?, 0, 'PENDING', 'Deuda Histórica Acumulada', ?, 'HISTORICAL')`,
                        [apartmentId, amount, issueDate],
                    );
                    console.log(
                        `[Fila ${i + 1}] 💰 Deuda de $${amount} cargada al Apartamento ID ${apartmentId}`,
                    );
                } else {
                    console.log(
                        `[Fila ${i + 1}] ℹ️ Sin deuda válida para cargar (Monto: ${deuda}).`,
                    );
                }
            } else {
                console.log(
                    `[Fila ${i + 1}] ℹ️ No se especificó deuda en el CSV.`,
                );
            }

            successCount++;
        } catch (error) {
            console.error(
                `[Fila ${i + 1}] ❌ Error al procesar Apto ${number}:`,
                error.message,
            );
            errorCount++;
        }
    }

    console.log(`\n================================`);
    console.log(`IMPORTACIÓN MASIVA FINALIZADA`);
    console.log(`================================`);
    console.log(`✅ Éxitos Totales (Fila completa procesada): ${successCount}`);
    console.log(`❌ Errores Totales: ${errorCount}`);
    process.exit();
}
//importData();
//-----------------------------------------------------------------------------

module.exports = {
    getAllUsers,
    toggleUserStatus,
    createUser,
    updateUser,
    getBuildings,
    toggleBuildingStatus,
    setComplexStatus,
    createBuilding,
    updateBuilding,
    assignBuildingAdmin,
    getDashboardStats,
};
