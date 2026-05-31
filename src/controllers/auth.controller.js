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

        if (user.status === "INACTIVE") {
            return res.status(401).json({ message: "Usuario INACTIVO" });
        }

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

const ownerLogin = async (req, res) => {
    const { accessCode } = req.body;

    if (!accessCode) {
        return res
            .status(400)
            .json({ message: "El código de acceso es obligatorio." });
    }

    try {
        // 1. Buscamos el apartamento por código y cruzamos (JOIN) con la tabla users
        // para obtener los datos del propietario y su contraseña.
        const [rows] = await db.query(
            `SELECT a.id as apt_id, a.number, a.building_id, u.id as user_id, u.name, u.role, u.password 
             FROM apartments a 
             INNER JOIN users u ON a.owner_id = u.id 
             WHERE a.access_code = ?`,
            [accessCode],
        );

        // Si no hay resultados, el código no existe o el apartamento aún no tiene dueño asignado
        if (rows.length === 0) {
            return res.status(401).json({
                message:
                    "Código de acceso inválido o apartamento sin propietario asignado.",
            });
        }

        const user = rows[0];

        // 3. Generamos el JWT inyectando los datos cruciales del propietario
        const token = jwt.sign(
            {
                id: user.user_id,
                role: user.role, // Será 'OWNER'
                apartmentId: user.apt_id,
                buildingId: user.building_id,
                unit: user.number,
            },
            process.env.JWT_SECRET,
            { expiresIn: "8h" },
        );

        // 4. Respondemos con el token y datos básicos
        res.json({
            message: "Login de propietario exitoso",
            token,
            user: {
                id: user.user_id.toString(),
                name: user.name,
                role: user.role,
                apartmentId: user.apt_id,
                buildingId: user.building_id,
                unit: user.number,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Error en el servidor al intentar iniciar sesión.",
        });
    }
};

module.exports = {
    login,
    ownerLogin,
};
