const db = require("../db");

const mapRow = (row) => ({
    id: row.id,
    label: row.label,
    usage: row.usage_type,
    contact: {
        fullName: row.full_name,
        organization: row.organization,
        title: row.title,
        tagline: row.tagline || "",
        email: row.email,
        cellPhone: row.cell_phone,
        workPhone: row.work_phone || "",
        addressLocality: row.address_locality,
        addressCountry: row.address_country,
        website: row.website,
        note: row.note || "",
        photoDataUrl: row.photo_data || "",
        social: row.social_json
            ? typeof row.social_json === "string"
                ? JSON.parse(row.social_json)
                : row.social_json
            : {},
    },
    isPublished: Boolean(row.is_published),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const pickPayload = (body) => ({
    label: body.label?.trim(),
    usage_type: body.usage || body.usage_type || "VENTAS_CAMPO",
    full_name: body.contact?.fullName ?? body.full_name,
    organization: body.contact?.organization ?? body.organization,
    title: body.contact?.title ?? body.title,
    tagline: body.contact?.tagline ?? body.tagline ?? null,
    email: body.contact?.email ?? body.email,
    cell_phone: body.contact?.cellPhone ?? body.cell_phone,
    work_phone: body.contact?.workPhone ?? body.work_phone ?? null,
    address_locality: body.contact?.addressLocality ?? body.address_locality,
    address_country: body.contact?.addressCountry ?? body.address_country,
    website: body.contact?.website ?? body.website,
    note: body.contact?.note ?? body.note ?? null,
    photo_data: body.contact?.photoDataUrl ?? body.photo_data ?? null,
    social_json: JSON.stringify(body.contact?.social ?? body.social ?? {}),
    is_published:
        body.isPublished === undefined
            ? body.is_published === undefined
                ? 1
                : body.is_published
                  ? 1
                  : 0
            : body.isPublished
              ? 1
              : 0,
});

const listVcards = async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT * FROM sales_vcards ORDER BY updated_at DESC",
        );
        res.json({ data: rows.map(mapRow) });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message:
                "Error al listar vCards. ¿Ejecutaste scripts/create_sales_vcards.sql?",
        });
    }
};

const getPublicVcard = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(
            "SELECT * FROM sales_vcards WHERE id = ? AND is_published = 1 LIMIT 1",
            [id],
        );
        if (!rows.length) {
            return res.status(404).json({ message: "Tarjeta no encontrada" });
        }
        res.json({ data: mapRow(rows[0]) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al cargar la tarjeta" });
    }
};

const createVcard = async (req, res) => {
    const p = pickPayload(req.body);
    if (!p.label || !p.full_name || !p.email || !p.cell_phone) {
        return res.status(400).json({ message: "Faltan campos obligatorios" });
    }
    try {
        const [result] = await db.query(
            `INSERT INTO sales_vcards (
        label, usage_type, full_name, organization, title, tagline,
        email, cell_phone, work_phone, address_locality, address_country,
        website, note, photo_data, social_json, is_published
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                p.label,
                p.usage_type,
                p.full_name,
                p.organization,
                p.title,
                p.tagline,
                p.email,
                p.cell_phone,
                p.work_phone,
                p.address_locality,
                p.address_country,
                p.website,
                p.note,
                p.photo_data,
                p.social_json,
                p.is_published,
            ],
        );
        const [rows] = await db.query(
            "SELECT * FROM sales_vcards WHERE id = ?",
            [result.insertId],
        );
        res.status(201).json({ data: mapRow(rows[0]) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al crear la tarjeta" });
    }
};

const updateVcard = async (req, res) => {
    const { id } = req.params;
    const p = pickPayload(req.body);
    try {
        const [existing] = await db.query(
            "SELECT id FROM sales_vcards WHERE id = ?",
            [id],
        );
        if (!existing.length) {
            return res.status(404).json({ message: "Tarjeta no encontrada" });
        }
        await db.query(
            `UPDATE sales_vcards SET
        label = ?, usage_type = ?, full_name = ?, organization = ?, title = ?, tagline = ?,
        email = ?, cell_phone = ?, work_phone = ?, address_locality = ?, address_country = ?,
        website = ?, note = ?, photo_data = ?, social_json = ?, is_published = ?
      WHERE id = ?`,
            [
                p.label,
                p.usage_type,
                p.full_name,
                p.organization,
                p.title,
                p.tagline,
                p.email,
                p.cell_phone,
                p.work_phone,
                p.address_locality,
                p.address_country,
                p.website,
                p.note,
                p.photo_data,
                p.social_json,
                p.is_published,
                id,
            ],
        );
        const [rows] = await db.query(
            "SELECT * FROM sales_vcards WHERE id = ?",
            [id],
        );
        res.json({ data: mapRow(rows[0]) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al actualizar la tarjeta" });
    }
};

const deleteVcard = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query("DELETE FROM sales_vcards WHERE id = ?", [id]);
        res.json({ message: "Tarjeta eliminada" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al eliminar la tarjeta" });
    }
};

module.exports = {
    listVcards,
    getPublicVcard,
    createVcard,
    updateVcard,
    deleteVcard,
};
