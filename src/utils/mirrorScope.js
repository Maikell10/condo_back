const db = require("../db");

const isReadOnlyMirror = (user) =>
    !!(user?.impersonating && user?.readOnlyMirror && user?.buildingId);

/** IDs de edificios visibles en sesión espejo o por admin_id habitual. */
const resolveManagedBuildingIds = async (tokenUser) => {
    if (isReadOnlyMirror(tokenUser)) {
        if (tokenUser.complexId) {
            const [rows] = await db.query(
                `SELECT id FROM buildings WHERE complex_id = ? AND status = 'ACTIVE'`,
                [tokenUser.complexId],
            );
            return rows.map((r) => r.id);
        }
        return [Number(tokenUser.buildingId)];
    }

    const adminUserId = tokenUser.id;
    const [rows] = await db.query(
        `SELECT DISTINCT b.id
         FROM buildings b
         LEFT JOIN residential_complexes rc ON b.complex_id = rc.id
         WHERE (b.admin_id = ? OR rc.admin_id = ?) AND b.status = 'ACTIVE'`,
        [adminUserId, adminUserId],
    );
    return rows.map((r) => r.id);
};

/** admin_settings.admin_id del edificio espejado (edificio o conjunto). */
const resolveSettingsAdminId = async (tokenUser) => {
    if (!isReadOnlyMirror(tokenUser)) {
        return tokenUser.id;
    }
    const [rows] = await db.query(
        `SELECT b.admin_id, rc.admin_id AS complex_admin_id
         FROM buildings b
         LEFT JOIN residential_complexes rc ON b.complex_id = rc.id
         WHERE b.id = ?`,
        [tokenUser.buildingId],
    );
    if (!rows.length) {
        return null;
    }
    return rows[0].admin_id || rows[0].complex_admin_id || null;
};

module.exports = {
    isReadOnlyMirror,
    resolveManagedBuildingIds,
    resolveSettingsAdminId,
};