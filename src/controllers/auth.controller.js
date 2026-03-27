const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db"); // Subimos un nivel para encontrar db.js
const { auditLog } = require("../utils/logger");

const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await db.query("SELECT * FROM users WHERE email = ?", [
            email,
        ]);

        if (users.length === 0) {
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        let extraData = {};

        if (user.role === "BUILDING_ADMIN") {
            const [buildings] = await db.query(
                "SELECT id as buildingId FROM buildings WHERE admin_id = ?",
                [user.id],
            );
            if (buildings.length > 0) extraData = buildings[0];
        } else if (user.role === "OWNER") {
            const [apartments] = await db.query(
                `
                SELECT a.id as apartmentId, a.building_id as buildingId, a.number as ownerCode
                FROM apartments a 
                WHERE a.owner_id = ?
            `,
                [user.id],
            );
            if (apartments.length > 0) extraData = apartments[0];
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "8h" },
        );

        // await db.query(
        //     "INSERT INTO audit_logs (user_id, action, module, payload) VALUES (?, 'LOGIN', 'LOGIN', ?)",
        //     [user.id, JSON.stringify({ device: req.headers["user-agent"] })],
        // );

        // Al final de una operación exitosa
        await auditLog(
            user.id,
            "LOGIN",
            "LOGIN",
            { device: req.headers["user-agent"] },
            req,
        );

        res.json({
            message: "Login exitoso",
            token,
            user: {
                id: user.id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
                ...extraData,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error en el servidor" });
    }
};

module.exports = {
    login,
};
