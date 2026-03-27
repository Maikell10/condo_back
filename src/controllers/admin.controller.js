const db = require("../db");

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

const getBuildings = async (req, res) => {
    try {
        const query = `
            SELECT 
                b.id, b.code, b.name, b.status,
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

module.exports = {
    getAllUsers,
    toggleUserStatus,
    getBuildings,
    toggleBuildingStatus,
};
