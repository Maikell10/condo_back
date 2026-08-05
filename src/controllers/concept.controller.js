const db = require("../db");

// Obtener todos los conceptos disponibles
const getConcepts = async (req, res) => {
    try {
        // 🔥 Agregamos el WHERE para ocultar el Fondo de Reserva del frontend
        const [concepts] = await db.query(
            "SELECT * FROM expense_concepts WHERE description != 'Fondo de Reserva' ORDER BY description ASC",
        );
        res.json({ success: true, data: concepts });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error al obtener conceptos",
        });
    }
};

// Crear un nuevo concepto (opcional, para alimentar el catálogo)
const createConcept = async (req, res) => {
    const { code, description } = req.body;
    try {
        await db.query(
            "INSERT INTO expense_concepts (code, description) VALUES (?, ?)",
            [code, description],
        );
        res.status(201).json({ message: "Concepto creado con éxito" });
    } catch (error) {
        res.status(500).json({ message: "Error al crear el concepto" });
    }
};

module.exports = { getConcepts, createConcept };
