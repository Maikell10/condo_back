const db = require("../db");

// Obtener todos los conceptos disponibles
const getConcepts = async (req, res) => {
    try {
        const [concepts] = await db.query(
            "SELECT * FROM expense_concepts ORDER BY code ASC",
        );
        res.json({ data: concepts });
    } catch (error) {
        res.status(500).json({ message: "Error al obtener el catálogo" });
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
