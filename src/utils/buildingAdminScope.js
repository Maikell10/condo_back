const db = require("../db");

const getManagedBuildingIds = async (adminUserId) => {
    const [rows] = await db.query(
        `SELECT DISTINCT b.id
         FROM buildings b
         LEFT JOIN residential_complexes rc ON b.complex_id = rc.id
         WHERE (b.admin_id = ? OR rc.admin_id = ?) AND b.status = 'ACTIVE'`,
        [adminUserId, adminUserId],
    );
    return rows.map((r) => r.id);
};

const getOwnerPortfolio = async (ownerId) => {
    const [rows] = await db.query(
        `SELECT
            a.id AS apartmentId,
            a.number,
            a.building_id AS buildingId,
            b.name AS buildingName
         FROM apartments a
         INNER JOIN buildings b ON b.id = a.building_id
         WHERE a.owner_id = ?
         ORDER BY b.name ASC, a.number ASC`,
        [ownerId],
    );
    return rows;
};

/**
 * Puede editar perfil del propietario si TODAS sus unidades están en edificios
 * que administra este building admin (edificio directo o conjunto completo).
 */
const evaluateOwnerEditScope = async (adminUserId, ownerId) => {
    const scopeIds = new Set(await getManagedBuildingIds(adminUserId));
    const portfolio = await getOwnerPortfolio(ownerId);

    if (!portfolio.length) {
        return {
            canEdit: false,
            code: "NO_UNITS",
            message: "Este usuario no tiene unidades registradas como propietario.",
            unitsInScope: [],
            outsideUnits: [],
        };
    }

    const outsideUnits = portfolio.filter((u) => !scopeIds.has(u.buildingId));
    const unitsInScope = portfolio.filter((u) => scopeIds.has(u.buildingId));

    if (outsideUnits.length > 0) {
        return {
            canEdit: false,
            code: "OUT_OF_SCOPE",
            message:
                "Este propietario tiene apartamentos en edificios fuera de su administración. Para cambiar sus datos de contacto debe contactar al administrador del sistema (super admin).",
            unitsInScope,
            outsideUnits,
        };
    }

    return {
        canEdit: true,
        code: "OK",
        message: null,
        unitsInScope,
        outsideUnits: [],
    };
};

const assertApartmentManagedByAdmin = async (adminUserId, apartmentId) => {
    const scopeIds = new Set(await getManagedBuildingIds(adminUserId));
    const [[apt]] = await db.query(
        `SELECT a.id, a.owner_id AS ownerId, a.building_id AS buildingId, a.number
         FROM apartments a WHERE a.id = ?`,
        [apartmentId],
    );
    if (!apt) {
        return { ok: false, status: 404, message: "Apartamento no encontrado" };
    }
    if (!scopeIds.has(apt.buildingId)) {
        return {
            ok: false,
            status: 403,
            message: "No tiene permiso sobre este apartamento.",
        };
    }
    if (!apt.ownerId) {
        return {
            ok: false,
            status: 400,
            message: "Esta unidad no tiene propietario asignado.",
        };
    }
    return { ok: true, apartment: apt };
};

module.exports = {
    getManagedBuildingIds,
    getOwnerPortfolio,
    evaluateOwnerEditScope,
    assertApartmentManagedByAdmin,
};
