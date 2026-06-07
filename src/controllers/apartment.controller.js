const db = require("../db");
const crypto = require("crypto");

const getApartmentsByBuilding = async (req, res) => {
    const { buildingId } = req.params;
    try {
        const query = `
            SELECT 
                a.id, 
                a.number, 
                u.name as ownerName, 
                a.alicuota,
                a.access_code,
                -- Calculamos el balance sumando los recibos PENDING
                COALESCE(SUM(CASE WHEN r.status = 'PENDING' THEN (r.amount - r.paid) ELSE 0 END), 0) as balance
            FROM apartments a
            LEFT JOIN users u ON a.owner_id = u.id
            LEFT JOIN receipts r ON a.id = r.apartment_id
            WHERE a.building_id = ?
            GROUP BY a.id
        `;
        const [apartments] = await db.query(query, [buildingId]);
        res.json({ data: apartments });
    } catch (error) {
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

const linkOwner = async (req, res) => {
    const { id } = req.params; // ID del apartamento
    const { userId } = req.body; // ID del usuario seleccionado en el modal

    try {
        // Actualizamos el owner_id en la tabla de apartamentos
        await db.query("UPDATE apartments SET owner_id = ? WHERE id = ?", [
            userId,
            id,
        ]);
        res.json({ message: "Propietario vinculado exitosamente" });
    } catch (error) {
        res.status(500).json({ message: "Error al vincular el propietario" });
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
    linkOwner,
    createApartment,
    getBankAccounts,
    createBankAccount,
    updateBankAccount,
    deleteBankAccount,
    getBuildingAliquots,
};
