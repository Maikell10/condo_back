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

const resolveOwnerEmailForCreate = () =>
    `sin-correo-${Date.now()}-${Math.floor(Math.random() * 10000)}@condominio.local`;

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
            WHERE (name LIKE ? OR email LIKE ?) 
            AND role = 'OWNER'
            LIMIT 10
        `;
        const [users] = await db.query(query, [`%${term}%`, `%${term}%`]);
        res.json({ data: users });
    } catch (error) {
        res.status(500).json({ message: "Error al buscar usuarios" });
    }
};

const getOwnerEditContextByApartment = async (req, res) => {
    const { apartmentId } = req.params;
    const adminUserId = req.user.id;

    try {
        const access = await assertApartmentManagedByAdmin(
            adminUserId,
            Number(apartmentId),
        );
        if (!access.ok) {
            return res.status(access.status).json({ message: access.message });
        }

        const ownerId = access.apartment.ownerId;
        const scope = await evaluateOwnerEditScope(adminUserId, ownerId);

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

const updateOwnerProfileByBuildingAdmin = async (req, res) => {
    const { ownerId } = req.params;
    const adminUserId = req.user.id;
    const { name } = req.body;

    if (!name?.trim()) {
        return res.status(400).json({ message: "El nombre es obligatorio" });
    }

    const emailInput = normalizeOptionalText(req.body.email);
    const cedula = normalizeCedula(req.body.cedula);
    const phone = normalizePhoneVe(req.body.phone);
    const sex = normalizeSex(req.body.sex);
    const birthDate = normalizeBirthDate(req.body.birthDate);

    try {
        const scope = await evaluateOwnerEditScope(
            adminUserId,
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

        const [[existing]] = await db.query(
            "SELECT email, role FROM users WHERE id = ?",
            [ownerId],
        );
        if (!existing || existing.role !== "OWNER") {
            return res.status(404).json({ message: "Propietario no encontrado" });
        }

        let emailToStore = existing.email;
        if (emailInput) {
            emailToStore = emailInput;
        } else if (
            !existing.email ||
            PLACEHOLDER_EMAIL_RE.test(existing.email)
        ) {
            emailToStore = resolveOwnerEmailForCreate();
        }

        await db.query(
            `UPDATE users SET name = ?, cedula = ?, email = ?, phone = ?, sex = ?, birth_date = ? WHERE id = ? AND role = 'OWNER'`,
            [
                name.trim(),
                cedula,
                emailToStore,
                phone,
                sex,
                birthDate,
                ownerId,
            ],
        );

        res.json({ message: "Datos del propietario actualizados correctamente" });
    } catch (error) {
        console.error("updateOwnerProfileByBuildingAdmin:", error);
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
    updateOwnerProfileByBuildingAdmin,
};
