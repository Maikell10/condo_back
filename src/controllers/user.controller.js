const db = require("../db");

const searchUsers = async (req, res) => {
    const { term } = req.query;
    try {
        // Buscamos usuarios que coincidan con el nombre o correo
        // Filtramos para que solo aparezcan los que tienen rol de 'PROPIETARIO'
        const query = `
            SELECT id, name, email 
            FROM users 
            WHERE (name LIKE ? OR email LIKE ?) 
            AND role = 'OWNER'
            LIMIT 10
        `;
        const [users] = await db.query(query, [`%${term}%`, `%${term}%`]);
        res.json({ data: users });
    } catch (error) {
        res.status(500).json({ message: "Error al buscar usuarios" });
    }
};

module.exports = {
    searchUsers,
};
