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

// NUEVO: Obtiene TODOS los contratos (Los del conjunto global + Los de cada edificio individual)
const getComplexContracts = async (req, res) => {
    const { complexId } = req.params;
    try {
        const query = `
            SELECT c.id, c.provider, c.service, c.monthly_amount as monthlyCost, 
            DATE_FORMAT(c.start_date, '%Y-%m-%d') as startDate,
            DATE_FORMAT(c.end_date, '%Y-%m-%d') as endDate,
            CASE WHEN c.is_active = 1 AND c.end_date >= CURRENT_DATE THEN 'ACTIVE' ELSE 'EXPIRED' END as status,
            b.name as buildingName
            FROM contracts c
            LEFT JOIN buildings b ON c.building_id = b.id
            WHERE c.complex_id = ? OR b.complex_id = ?
            ORDER BY c.start_date DESC
        `;
        // Explicación del WHERE:
        // c.complex_id = ? -> Trae los contratos globales del conjunto
        // b.complex_id = ? -> Trae los contratos particulares de las torres de ese conjunto

        const [contracts] = await db.query(query, [complexId, complexId]);
        res.json({ data: contracts });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Error al obtener contratos del conjunto",
        });
    }
};

// MODIFICADO: Capaz de crear contratos globales o particulares
const createContract = async (req, res) => {
    const {
        buildingId,
        complexId,
        provider,
        service,
        monthlyCost,
        startDate,
        endDate,
    } = req.body;

    try {
        let finalBuildingId = buildingId;
        let finalComplexId = complexId || null;

        // Si desde Angular mandamos 'ALL', significa que es global para el Conjunto
        if (buildingId === "ALL") {
            finalBuildingId = null;
        }

        await db.query(
            `INSERT INTO contracts 
            (building_id, complex_id, provider, service, monthly_amount, start_date, end_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                finalBuildingId,
                finalComplexId,
                provider,
                service,
                monthlyCost,
                startDate,
                endDate,
            ],
        );

        res.status(201).json({ message: "Contrato registrado con éxito" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al crear el contrato" });
    }
};

module.exports = { getContracts, createContract, getComplexContracts };
