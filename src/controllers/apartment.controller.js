const db = require("../db");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
    normalizeOptionalText,
    normalizeCedula,
    normalizePhoneVe,
    normalizeSex,
    normalizeBirthDate,
} = require("../utils/userProfile");
const { assertApartmentUnassignedInScope } = require("../utils/buildingAdminScope");

const resolveOwnerEmailForCreate = (email) => {
    const clean = normalizeOptionalText(email);
    if (clean) return clean;
    return `sin-correo-${Date.now()}-${Math.floor(Math.random() * 10000)}@condominio.local`;
};

const getApartmentsByBuilding = async (req, res) => {
    const { buildingId } = req.params;
    try {
        const query = `
            SELECT 
                a.id, 
                a.number,
                a.owner_id AS ownerId,
                u.name as ownerName, 
                a.alicuota,
                a.access_code,
                COALESCE(SUM(CASE WHEN r.status IN ('PENDING', 'PARTIAL') THEN (r.amount - COALESCE(r.paid, 0)) ELSE 0 END), 0) as balance
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            LEFT JOIN receipts r ON a.id = r.apartment_id
            WHERE a.building_id = ?
            GROUP BY a.id, a.number, a.owner_id, u.name, a.alicuota, a.access_code
        `;

        const [apartments] = await db.query(query, [buildingId]);

        // 🔥 Blindaje Extra: Nos aseguramos de que Node.js lo envíe como un Número puro y no como un String de MySQL
        const formattedApartments = apartments.map((apt) => ({
            ...apt,
            balance: Number(apt.balance),
        }));

        res.json({ data: formattedApartments });
    } catch (error) {
        console.error("Error en getApartmentsByBuilding:", error);
        res.status(500).json({ message: "Error al obtener apartamentos" });
    }
};

const updateAlicuota = async (req, res) => {
    const { id } = req.params;
    const { alicuota } = req.body; // Viene como decimal (ej: 0.052)
    try {
        await db.query("UPDATE apartments SET alicuota = ? WHERE id = ?", [
            alicuota,
            id,
        ]);
        res.json({ message: "Alícuota actualizada correctamente" });
    } catch (error) {
        res.status(500).json({ message: "Error al actualizar" });
    }
};

/**
 * Crea un usuario OWNER y lo asigna al apartamento (solo si está vacío y en alcance del admin).
 */
const createOwnerAndAssignToApartment = async (req, res) => {
    const { apartmentId } = req.params;
    const adminUserId = req.user.id;
    const { name, password } = req.body;

    if (!name?.trim()) {
        return res.status(400).json({ message: "El nombre es obligatorio" });
    }
    if (!password || String(password).length < 6) {
        return res
            .status(400)
            .json({ message: "La contraseña temporal debe tener al menos 6 caracteres" });
    }

    const emailInput = normalizeOptionalText(req.body.email);
    const cedula = normalizeCedula(req.body.cedula);
    const phone = normalizePhoneVe(req.body.phone);
    const sex = normalizeSex(req.body.sex);
    const birthDate = normalizeBirthDate(req.body.birthDate);
    const emailToStore = emailInput || resolveOwnerEmailForCreate(null);

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const access = await assertApartmentUnassignedInScope(
            adminUserId,
            Number(apartmentId),
            connection,
        );
        if (!access.ok) {
            await connection.rollback();
            return res.status(access.status).json({ message: access.message });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(String(password), salt);

        const [userResult] = await connection.query(
            `INSERT INTO users (name, cedula, email, phone, sex, birth_date, password, role, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'OWNER', 'ACTIVE')`,
            [
                name.trim(),
                cedula,
                emailToStore,
                phone,
                sex,
                birthDate,
                hashedPassword,
            ],
        );

        const ownerId = userResult.insertId;

        const [updResult] = await connection.query(
            `UPDATE apartments SET owner_id = ? WHERE id = ? AND owner_id IS NULL`,
            [ownerId, apartmentId],
        );

        if (updResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(409).json({
                message:
                    "No se pudo asignar la unidad (posiblemente ya tiene propietario). Revisa e intenta de nuevo.",
            });
        }

        await connection.commit();
        res.status(201).json({
            message: "Propietario creado y unidad asignada correctamente",
            ownerId,
        });
    } catch (error) {
        await connection.rollback();
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                message: "El correo electrónico ya está registrado",
            });
        }
        console.error("createOwnerAndAssignToApartment:", error);
        if (error.code === "ER_BAD_FIELD_ERROR") {
            return res.status(503).json({
                message:
                    "Faltan columnas de perfil en users. Ejecuta los scripts SQL de perfil en MySQL.",
            });
        }
        res.status(500).json({ message: "Error al crear el propietario" });
    } finally {
        connection.release();
    }
};

const createApartment = async (req, res) => {
    // Obtenemos los datos del cuerpo de la petición
    const { number, alicuota, buildingId } = req.body;

    try {
        // Validamos que la alícuota sea un número válido
        if (isNaN(alicuota) || alicuota <= 0) {
            return res
                .status(400)
                .json({ message: "La alícuota debe ser un número positivo." });
        }

        // Generar un código alfanumérico único de 8 caracteres
        const accessCode = crypto.randomBytes(4).toString("hex").toUpperCase();

        await db.query(
            "INSERT INTO apartments (number, alicuota, building_id, access_code) VALUES (?, ?, ?, ?)",
            [number, alicuota, buildingId, accessCode],
        );

        res.status(201).json({
            message: "Apartamento creado exitosamente en el sistema.",
            access_code: accessCode,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message:
                "Error al registrar el apartamento. Verifique si el número ya existe.",
        });
    }
};

// Obtener todas las cuentas de un edificio
const getBankAccounts = async (req, res) => {
    const { buildingId } = req.params;
    const { complexId } = req.query; // Lo recibimos si viene 'ALL'

    try {
        if (buildingId === "ALL") {
            // VISTA GLOBAL: Cuentas de todos los edificios del conjunto
            const query = `
                SELECT ba.*, b.name as buildingName
                FROM bank_accounts ba
                JOIN buildings b ON ba.building_id = b.id
                WHERE b.complex_id = ?
                ORDER BY b.name ASC, ba.bank_name ASC
            `;
            const [accounts] = await db.query(query, [complexId]);
            res.json({ data: accounts });
        } else {
            // VISTA INDIVIDUAL: Cuentas de un solo edificio
            const query = `
                SELECT ba.*
                FROM bank_accounts ba
                WHERE ba.building_id = ?
                ORDER BY ba.bank_name ASC
            `;
            const [accounts] = await db.query(query, [buildingId]);
            res.json({ data: accounts });
        }
    } catch (error) {
        console.error("Error al obtener cuentas:", error);
        res.status(500).json({
            message: "Error al obtener las cuentas bancarias",
        });
    }
};

// Crear una nueva cuenta
const createBankAccount = async (req, res) => {
    const {
        building_id,
        complex_id,
        bank_name,
        account_number,
        account_type,
        holder_name,
        holder_id,
    } = req.body;

    try {
        // 🔥 LÓGICA DE CONJUNTO RESIDENCIAL (INSERCIÓN MASIVA)
        if (building_id === "ALL" && complex_id) {
            // 1. Buscamos todos los edificios que pertenecen a este conjunto
            const [buildings] = await db.query(
                "SELECT id FROM buildings WHERE complex_id = ? AND status = 'ACTIVE'",
                [complex_id],
            );

            if (buildings.length === 0) {
                return res.status(404).json({
                    message: "No hay edificios activos en este conjunto.",
                });
            }

            // 2. Preparamos la data para el "Bulk Insert" (Insertar múltiples filas de golpe)
            // MySQL requiere un arreglo de arreglos: [ [val1, val2], [val1, val2] ]
            const values = buildings.map((b) => [
                b.id,
                bank_name,
                account_number,
                account_type,
                holder_name,
                holder_id,
                "ACTIVE",
            ]);

            // 3. Insertamos en todos los edificios simultáneamente
            await db.query(
                `INSERT INTO bank_accounts 
                (building_id, bank_name, account_number, account_type, holder_name, holder_id, status) 
                VALUES ?`,
                [values], // Nota: En una inserción bulk con MySQL2, se pasa el array anidado dentro de un array
            );

            return res.status(201).json({
                message: `Cuenta registrada exitosamente en ${buildings.length} edificios.`,
            });
        }

        // LÓGICA NORMAL (UN SOLO EDIFICIO)
        else {
            await db.query(
                `INSERT INTO bank_accounts 
                (building_id, bank_name, account_number, account_type, holder_name, holder_id, status) 
                VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
                [
                    building_id,
                    bank_name,
                    account_number,
                    account_type,
                    holder_name,
                    holder_id,
                ],
            );
            return res
                .status(201)
                .json({ message: "Cuenta registrada exitosamente." });
        }
    } catch (error) {
        console.error("Error al crear cuenta bancaria:", error);
        res.status(500).json({
            message: "Error interno al registrar la cuenta.",
        });
    }
};

// Editar una cuenta existente
const updateBankAccount = async (req, res) => {
    const { id } = req.params;
    const {
        bank_name,
        account_number,
        account_type,
        holder_name,
        holder_id,
        status,
    } = req.body;

    try {
        const query = `
            UPDATE bank_accounts 
            SET bank_name = ?, account_number = ?, account_type = ?, holder_name = ?, holder_id = ?, status = ?
            WHERE id = ?
        `;
        await db.query(query, [
            bank_name,
            account_number,
            account_type,
            holder_name,
            holder_id,
            status,
            id,
        ]);

        res.json({ message: "Cuenta bancaria actualizada correctamente" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al actualizar la cuenta" });
    }
};

// Eliminar (o desactivar) una cuenta
const deleteBankAccount = async (req, res) => {
    const { id } = req.params;
    try {
        // Opción A: Borrado físico (Si prefieres borrado lógico, usa un UPDATE status = 'INACTIVE')
        await db.query("DELETE FROM bank_accounts WHERE id = ?", [id]);
        res.json({ message: "Cuenta bancaria eliminada" });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message:
                "Error al eliminar la cuenta. Verifica que no tenga pagos asociados.",
        });
    }
};

// Obtiene la lista de alícuotas para que los propietarios la vean
const getBuildingAliquots = async (req, res) => {
    const { buildingId } = req.params;

    try {
        const query = `
            SELECT a.id, a.number as unit, u.name as ownerName, a.owner_id as ownerId, a.alicuota
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            WHERE a.building_id = ?
            ORDER BY a.number ASC
        `;
        const [aliquots] = await db.query(query, [buildingId]);
        res.json({ data: aliquots });
    } catch (error) {
        console.error("Error en getBuildingAliquots:", error);
        res.status(500).json({
            message: "Error al obtener la tabla de alícuotas.",
        });
    }
};

module.exports = {
    getApartmentsByBuilding,
    updateAlicuota,
    createOwnerAndAssignToApartment,
    createApartment,
    getBankAccounts,
    createBankAccount,
    updateBankAccount,
    deleteBankAccount,
    getBuildingAliquots,
};
