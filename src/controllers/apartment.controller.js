const db = require("../db");

const getApartmentsByBuilding = async (req, res) => {
    const { buildingId } = req.params;
    try {
        const query = `
            SELECT 
                a.id, 
                a.number, 
                u.name as ownerName, 
                a.alicuota,
                -- Calculamos el balance sumando los recibos PENDING
                COALESCE(SUM(CASE WHEN r.status = 'PENDING' THEN (r.amount - r.paid) ELSE 0 END), 0) as balance
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            LEFT JOIN receipts r ON a.id = r.apartment_id
            WHERE a.building_id = ?
            GROUP BY a.id
        `;
        const [apartments] = await db.query(query, [buildingId]);
        res.json({ data: apartments });
    } catch (error) {
        res.status(500).json({ message: "Error al obtener apartamentos" });
    }
};

const updateAlicuota = async (req, res) => {
    const { id } = req.params;
    const { alicuota } = req.body; // Viene como decimal (ej: 0.052)
    try {
        await db.query("UPDATE apartments SET alicuota = ? WHERE id = ?", [
            alicuota,
            id,
        ]);
        res.json({ message: "Alícuota actualizada correctamente" });
    } catch (error) {
        res.status(500).json({ message: "Error al actualizar" });
    }
};

const linkOwner = async (req, res) => {
    const { id } = req.params; // ID del apartamento
    const { userId } = req.body; // ID del usuario seleccionado en el modal

    try {
        // Actualizamos el owner_id en la tabla de apartamentos
        await db.query("UPDATE apartments SET owner_id = ? WHERE id = ?", [
            userId,
            id,
        ]);
        res.json({ message: "Propietario vinculado exitosamente" });
    } catch (error) {
        res.status(500).json({ message: "Error al vincular el propietario" });
    }
};

const createApartment = async (req, res) => {
    // Obtenemos los datos del cuerpo de la petición
    const { number, alicuota, buildingId } = req.body;

    try {
        // Validamos que la alícuota sea un número válido
        if (isNaN(alicuota) || alicuota <= 0) {
            return res
                .status(400)
                .json({ message: "La alícuota debe ser un número positivo." });
        }

        await db.query(
            "INSERT INTO apartments (number, alicuota, building_id) VALUES (?, ?, ?)",
            [number, alicuota, buildingId],
        );

        res.status(201).json({
            message: "Apartamento creado exitosamente en el sistema.",
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message:
                "Error al registrar el apartamento. Verifique si el número ya existe.",
        });
    }
};

module.exports = {
    getApartmentsByBuilding,
    updateAlicuota,
    linkOwner,
    createApartment,
};
