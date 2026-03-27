const db = require("../db");

const getContracts = async (req, res) => {
    const { buildingId } = req.params;
    try {
        const query = `
            SELECT id, provider, service, monthly_amount as monthlyCost, 
            DATE_FORMAT(start_date, '%Y-%m-%d') as startDate,
            DATE_FORMAT(end_date, '%Y-%m-%d') as endDate,
            CASE WHEN is_active = 1 AND end_date >= CURRENT_DATE THEN 'ACTIVE' ELSE 'EXPIRED' END as status
            FROM contracts WHERE building_id = ?
        `;
        const [contracts] = await db.query(query, [buildingId]);
        res.json({ data: contracts });
    } catch (error) {
        res.status(500).json({ message: "Error al obtener contratos" });
    }
};

const createContract = async (req, res) => {
    const { buildingId, provider, service, monthlyCost, startDate, endDate } =
        req.body;
    try {
        await db.query(
            "INSERT INTO contracts (building_id, provider, service, monthly_amount, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)",
            [buildingId, provider, service, monthlyCost, startDate, endDate],
        );
        res.status(201).json({ message: "Contrato registrado con éxito" });
    } catch (error) {
        res.status(500).json({ message: "Error al crear el contrato" });
    }
};

module.exports = { getContracts, createContract };
