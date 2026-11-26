const db = require("../db");
const { resolveManagedBuildingIds } = require("./mirrorScope");

const getManagedBuildingIds = async (tokenUser) => {
    return resolveManagedBuildingIds(tokenUser);
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
const evaluateOwnerEditScope = async (tokenUser, ownerId) => {
    const scopeIds = new Set(await getManagedBuildingIds(tokenUser));
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

const assertApartmentManagedByAdmin = async (tokenUser, apartmentId) => {
    const scopeIds = new Set(await getManagedBuildingIds(tokenUser));
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

/** Apartamento sin propietario y dentro del alcance del building admin. */
/**
 * @param {import("mysql2/promise").Pool|import("mysql2/promise").PoolConnection} connOrPool
 */
const assertApartmentUnassignedInScope = async (
    tokenUser,
    apartmentId,
    connOrPool = db,
) => {
    const scopeIds = new Set(await getManagedBuildingIds(tokenUser));
    const [[apt]] = await connOrPool.query(
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
    if (apt.ownerId != null) {
        return {
            ok: false,
            status: 400,
            message: "Esta unidad ya tiene propietario asignado.",
        };
    }
    return { ok: true, apartment: apt };
};

module.exports = {
    getManagedBuildingIds,
    getOwnerPortfolio,
    evaluateOwnerEditScope,
    assertApartmentManagedByAdmin,
    assertApartmentUnassignedInScope,
};
