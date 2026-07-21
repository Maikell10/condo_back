const db = require("../db");

// --- ADMINISTRADOR ---

// 1. Crear nueva encuesta
const createPoll = async (req, res) => {
    const { buildingId, question, durationDays } = req.body;

    try {
        // Calculamos la fecha de cierre sumando los días a la fecha actual
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + Number(durationDays));

        await db.query(
            "INSERT INTO polls (building_id, question, end_date) VALUES (?, ?, ?)",
            [buildingId, question, endDate],
        );

        res.status(201).json({
            success: true,
            message: "Encuesta publicada con éxito.",
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const getPollsByBuilding = async (req, res) => {
    const { buildingId } = req.params;
    try {
        // 🔥 MAGIA SQL: Buscamos todas las encuestas de TODOS los edificios
        // que pertenezcan al mismo 'admin_id' del edificio consultado.
        const query = `
            SELECT p.* 
            FROM polls p
            JOIN buildings b ON p.building_id = b.id
            WHERE b.admin_id = (
                SELECT admin_id FROM buildings WHERE id = ?
            )
            ORDER BY p.created_at DESC
        `;

        const [polls] = await db.query(query, [buildingId]);
        res.json({ success: true, data: polls });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// 2. Obtener resultados detallados (Para el Libro de Actas)
const getPollResults = async (req, res) => {
    const { pollId } = req.params;

    try {
        const [polls] = await db.query("SELECT * FROM polls WHERE id = ?", [
            pollId,
        ]);
        if (polls.length === 0) {
            return res.status(404).json({ message: "Encuesta no encontrada" });
        }

        const poll = polls[0];

        // 🔥 Al sumar los votos aquí, MySQL automáticamente contará los de TODOS
        // los apartamentos de TODOS los edificios del complejo, porque los votos
        // están atados al poll_id directamente.
        const [results] = await db.query(
            `
            SELECT 
                SUM(CASE WHEN vote = 'SI' THEN 1 ELSE 0 END) as total_si,
                SUM(CASE WHEN vote = 'NO' THEN 1 ELSE 0 END) as total_no,
                COUNT(*) as total_votes
            FROM poll_votes 
            WHERE poll_id = ?
        `,
            [pollId],
        );

        const data = results[0];

        // Auto-cierre: Si la fecha actual superó la fecha de fin, forzamos status a CLOSED
        const isClosed =
            new Date() > new Date(poll.end_date) || poll.status === "CLOSED";

        res.json({
            success: true,
            data: {
                ...poll,
                isClosed,
                results: {
                    si: Number(data.total_si) || 0,
                    no: Number(data.total_no) || 0,
                    total: Number(data.total_votes) || 0,
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// --- PROPIETARIOS ---

// 3. Votar (Blindado a 1 voto por apartamento)
const castVote = async (req, res) => {
    const { pollId, apartmentId, vote } = req.body;

    try {
        // Validar si la encuesta sigue abierta
        const [polls] = await db.query(
            "SELECT end_date, status FROM polls WHERE id = ?",
            [pollId],
        );
        if (polls.length === 0)
            return res.status(404).json({ message: "Encuesta no existe." });

        const poll = polls[0];
        if (new Date() > new Date(poll.end_date) || poll.status === "CLOSED") {
            return res.status(400).json({
                message:
                    "La encuesta ya está cerrada, no se admiten más votos.",
            });
        }

        // Registrar el voto. Si el apartmentId ya votó, el UNIQUE KEY de MySQL lanzará error (código ER_DUP_ENTRY)
        await db.query(
            "INSERT INTO poll_votes (poll_id, apartment_id, vote) VALUES (?, ?, ?)",
            [pollId, apartmentId, vote],
        );

        res.status(200).json({
            success: true,
            message: "Voto registrado exitosamente.",
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                success: false,
                message: "Tu apartamento ya votó en esta encuesta.",
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { createPoll, getPollResults, castVote, getPollsByBuilding };
