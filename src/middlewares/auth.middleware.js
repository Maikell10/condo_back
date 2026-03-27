const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
    // Buscar el token en las cabeceras
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res
            .status(403)
            .json({ message: "Se requiere un token de autenticación" });
    }

    // El formato siempre es "Bearer eyJhbGci..." así que lo separamos
    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(403).json({ message: "Formato de token inválido" });
    }

    try {
        // Verificamos el token con nuestra clave secreta
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Guardamos los datos del usuario (id y role) en la request para que el controlador los use
        req.user = decoded;

        // Pasamos al siguiente paso (el controlador)
        next();
    } catch (error) {
        return res.status(401).json({ message: "Token inválido o expirado" });
    }
};

// Podemos crear validadores extra por roles
const isOwner = (req, res, next) => {
    if (req.user.role !== "OWNER") {
        return res
            .status(403)
            .json({ message: "Acceso denegado. Solo para propietarios." });
    }
    next();
};

const isBuildingAdmin = (req, res, next) => {
    if (req.user.role !== "BUILDING_ADMIN") {
        return res.status(403).json({
            message: "Acceso denegado. Solo para administradores de edificio.",
        });
    }
    next();
};

const isSuperAdmin = (req, res, next) => {
    if (req.user.role !== "SUPER_ADMIN") {
        return res.status(403).json({
            message: "Acceso denegado. Solo para administradores de edificio.",
        });
    }
    next();
};

module.exports = {
    verifyToken,
    isOwner,
    isBuildingAdmin,
    isSuperAdmin,
};
