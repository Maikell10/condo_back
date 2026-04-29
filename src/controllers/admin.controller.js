const db = require("../db");
const bcrypt = require("bcryptjs");

// Obtener todos los usuarios del sistema con info de su edificio
// controllers/user.controller.js
const getAllUsers = async (req, res) => {
    try {
        const query = `
            SELECT 
                u.id, u.name, u.email, u.role, u.status,
                -- Obtenemos el nombre del edificio a través de la relación con apartamentos
                -- Usamos GROUP_CONCAT por si el usuario tiene propiedades en varios edificios
                GROUP_CONCAT(DISTINCT b.name SEPARATOR ', ') as buildingName
            FROM users u
            LEFT JOIN apartments a ON u.id = a.owner_id
            LEFT JOIN buildings b ON a.building_id = b.id
            GROUP BY u.id
            ORDER BY u.id DESC
        `;
        const [users] = await db.query(query);
        res.json({ data: users });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Error al obtener usuarios y sus edificios",
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
        const query = `
            SELECT 
                b.id, b.code, b.name, b.status, b.address,
                u.email as adminEmail,
                (SELECT COUNT(*) FROM apartments WHERE building_id = b.id) as totalApartments
            FROM buildings b
            LEFT JOIN users u ON b.admin_id = u.id
            ORDER BY b.id DESC
        `;
        const [buildings] = await db.query(query);
        res.json({ data: buildings });
    } catch (error) {
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

module.exports = {
    getAllUsers,
    toggleUserStatus,
    createUser,
    updateUser,
    getBuildings,
    toggleBuildingStatus,
    createBuilding,
    updateBuilding,
    assignBuildingAdmin,
    getDashboardStats,
};
