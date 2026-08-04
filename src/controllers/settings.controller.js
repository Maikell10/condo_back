const db = require("../db");

// Obtener configuraciones del administrador
const getSettings = async (req, res) => {
    const adminId = req.user.id;

    try {
        const [settings] = await db.query(
            "SELECT * FROM admin_settings WHERE admin_id = ?",
            [adminId],
        );

        // Si no tiene configuración previa, devolvemos los valores por defecto
        if (settings.length === 0) {
            return res.json({
                success: true,
                data: { has_reserve_fund: 0, reserve_fund_percentage: 0 },
            });
        }
        res.json({ success: true, data: settings[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Guardar o actualizar configuraciones
const updateSettings = async (req, res) => {
    const adminId = req.user.id;
    const { hasReserveFund, reserveFundPercentage } = req.body;

    try {
        // 🔥 ON DUPLICATE KEY UPDATE: Si el admin_id ya existe, actualiza. Si no, lo inserta.
        const query = `
            INSERT INTO admin_settings (admin_id, has_reserve_fund, reserve_fund_percentage) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE 
            has_reserve_fund = VALUES(has_reserve_fund), 
            reserve_fund_percentage = VALUES(reserve_fund_percentage)
        `;

        await db.query(query, [
            adminId,
            hasReserveFund || false,
            reserveFundPercentage || 0,
        ]);
        res.json({
            success: true,
            message: "Configuración actualizada correctamente.",
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { getSettings, updateSettings };
