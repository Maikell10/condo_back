const db = require("../db");
const {
    normalizeOptionalText,
    normalizeCedula,
    normalizePhoneVe,
    normalizeSex,
    normalizeBirthDate,
} = require("../utils/userProfile");
const {
    evaluateOwnerEditScope,
    assertApartmentManagedByAdmin,
} = require("../utils/buildingAdminScope");

const PLACEHOLDER_EMAIL_RE = /^sin-correo-.+@condominio\.local$/i;

const OWNER_PROFILE_FIELDS = `
    u.id,
    u.name,
    u.email,
    u.cedula,
    u.phone,
    u.sex,
    DATE_FORMAT(u.birth_date, '%Y-%m-%d') AS birthDate,
    u.role
`;

const searchUsers = async (req, res) => {
    const { term } = req.query;
    try {
        const query = `
            SELECT id, name, email 
            FROM users 
            WHERE role = 'OWNER'
            AND (name LIKE ? OR IFNULL(email, '') LIKE ?)
            LIMIT 10
        `;
        const like = `%${term}%`;
        const [users] = await db.query(query, [like, like]);
        res.json({ data: users });
    } catch (error) {
        res.status(500).json({ message: "Error al buscar usuarios" });
    }
};

const getOwnerEditContextByApartment = async (req, res) => {
    const { apartmentId } = req.params;

    try {
        const access = await assertApartmentManagedByAdmin(
            req.user,
            Number(apartmentId),
        );
        if (!access.ok) {
            return res.status(access.status).json({ message: access.message });
        }

        const ownerId = access.apartment.ownerId;
        const scope = await evaluateOwnerEditScope(req.user, ownerId);

        const base = {
            apartmentId: access.apartment.id,
            apartmentNumber: access.apartment.number,
            ownerId,
            canEdit: scope.canEdit,
            code: scope.code,
            message: scope.message,
            unitsInScope: scope.unitsInScope,
            outsideUnits: scope.outsideUnits,
        };

        if (!scope.canEdit) {
            return res.json({ data: base });
        }

        const [[owner]] = await db.query(
            `SELECT ${OWNER_PROFILE_FIELDS} FROM users u WHERE u.id = ? AND u.role = 'OWNER'`,
            [ownerId],
        );

        if (!owner) {
            return res.status(404).json({ message: "Propietario no encontrado" });
        }

        return res.json({
            data: {
                ...base,
                owner,
            },
        });
    } catch (error) {
        console.error("getOwnerEditContextByApartment:", error);
        if (error.code === "ER_BAD_FIELD_ERROR") {
            return res.status(503).json({
                message:
                    "Faltan columnas de perfil en users. Ejecuta los scripts SQL de perfil en MySQL.",
            });
        }
        res.status(500).json({ message: "Error al validar edición del propietario" });
    }
};

const loadOwnerProfile = async (ownerId) => {
    const [[owner]] = await db.query(
        `SELECT ${OWNER_PROFILE_FIELDS} FROM users u WHERE u.id = ? AND u.role = 'OWNER'`,
        [ownerId],
    );
    if (!owner) return null;

    const [ownedApartments] = await db.query(
        `SELECT a.id, a.number, b.name AS buildingName
         FROM apartments a
         JOIN buildings b ON b.id = a.building_id
         WHERE a.owner_id = ?
         ORDER BY b.name, a.number`,
        [ownerId],
    );
    return { ...owner, ownedApartments };
};

const persistOwnerProfile = async (ownerId, body) => {
    const name = body.name;
    if (!name?.trim()) {
        const error = new Error("El nombre es obligatorio");
        error.status = 400;
        throw error;
    }

    const emailInput = normalizeOptionalText(body.email);
    const cedula = normalizeCedula(body.cedula);
    const phone = normalizePhoneVe(body.phone);
    const sex = normalizeSex(body.sex);
    const birthDate = normalizeBirthDate(body.birthDate);

    const [[existing]] = await db.query(
        "SELECT email, role FROM users WHERE id = ?",
        [ownerId],
    );
    if (!existing || existing.role !== "OWNER") {
        const error = new Error("Propietario no encontrado");
        error.status = 404;
        throw error;
    }

    let emailToStore = emailInput !== undefined ? emailInput : existing.email;
    if (emailToStore && PLACEHOLDER_EMAIL_RE.test(String(emailToStore))) {
        emailToStore = null;
    }

    await db.query(
        `UPDATE users SET name = ?, cedula = ?, email = ?, phone = ?, sex = ?, birth_date = ? WHERE id = ? AND role = 'OWNER'`,
        [name.trim(), cedula, emailToStore, phone, sex, birthDate, ownerId],
    );
};

const getMyOwnerProfile = async (req, res) => {
    try {
        const profile = await loadOwnerProfile(req.user.id);
        if (!profile) {
            return res.status(404).json({ message: "Propietario no encontrado" });
        }
        res.json({ data: profile });
    } catch (error) {
        console.error("getMyOwnerProfile:", error);
        if (error.code === "ER_BAD_FIELD_ERROR") {
            return res.status(503).json({
                message:
                    "Faltan columnas de perfil en users. Ejecuta los scripts SQL de perfil en MySQL.",
            });
        }
        res.status(500).json({ message: "Error al cargar tu perfil" });
    }
};

const updateMyOwnerProfile = async (req, res) => {
    try {
        await persistOwnerProfile(req.user.id, req.body);
        const profile = await loadOwnerProfile(req.user.id);
        res.json({
            message: "Datos actualizados correctamente",
            data: profile,
        });
    } catch (error) {
        console.error("updateMyOwnerProfile:", error);
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                message: "El correo ya está en uso por otro usuario",
            });
        }
        res.status(500).json({ message: "Error al actualizar tu perfil" });
    }
};

const updateOwnerProfileByBuildingAdmin = async (req, res) => {
    const { ownerId } = req.params;

    try {
        const scope = await evaluateOwnerEditScope(
            req.user,
            Number(ownerId),
        );
        if (!scope.canEdit) {
            return res.status(403).json({
                message:
                    scope.message ||
                    "No puede editar este propietario. Contacte al administrador del sistema.",
                code: scope.code,
                outsideUnits: scope.outsideUnits,
            });
        }

        await persistOwnerProfile(ownerId, req.body);
        res.json({ message: "Datos del propietario actualizados correctamente" });
    } catch (error) {
        console.error("updateOwnerProfileByBuildingAdmin:", error);
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                message: "El correo ya está en uso por otro usuario",
            });
        }
        res.status(500).json({ message: "Error al actualizar el propietario" });
    }
};

module.exports = {
    searchUsers,
    getOwnerEditContextByApartment,
    getMyOwnerProfile,
    updateMyOwnerProfile,
    updateOwnerProfileByBuildingAdmin,
};
