const db = require("../db"); // Subimos un nivel para encontrar db.js

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

module.exports = {
    // ... tus otras exportaciones
    getBuildingsByComplex,
};
