const db = require("../db");

const reportPayment = async (req, res) => {
    const {
        bankAccount,
        operationType,
        referenceNumber,
        amount,
        operationDate,
        currency = "USD", // Si no viene, asume USD
        exchangeRate = 1.0, // Si no viene, asume tasa 1.0
        amountLocal = null, // Monto en la moneda local (ej. Bolívares)
    } = req.body;
    const userId = req.user.id;

    try {
        // --- 🔒 CANDADO 1: Evitar fechas en el futuro ---
        const paymentDateObj = new Date(operationDate);
        const today = new Date();
        if (paymentDateObj > today) {
            return res.status(400).json({
                message:
                    "Operación rechazada: La fecha de la operación no puede ser en el futuro.",
            });
        }

        // 1. Buscamos el apartment_id asociado a este propietario
        const [apartments] = await db.query(
            "SELECT id FROM apartments WHERE owner_id = ?",
            [userId],
        );

        if (apartments.length === 0) {
            return res.status(404).json({
                message:
                    "No se encontró un apartamento asociado a este usuario.",
            });
        }
        const apartmentId = apartments[0].id;

        // --- 🔒 CANDADO 2: Evitar pagos duplicados (Referencia + Banco) ---
        const [existingPayment] = await db.query(
            `SELECT id FROM payments WHERE reference = ? AND bank_account = ? AND apartment_id = ?`,
            [referenceNumber, bankAccount, apartmentId],
        );

        if (existingPayment.length > 0) {
            return res.status(400).json({
                message:
                    "Error: Ya existe un reporte de pago con este número de referencia a esta cuenta bancaria.",
            });
        }

        // 2. Insertamos el reporte de pago
        const insertQuery = `
            INSERT INTO payments (
                apartment_id, 
                bank_account, 
                operation_type, 
                reference, 
                amount, 
                currency, 
                exchange_rate, 
                amount_local, 
                payment_date, 
                status
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')
        `;

        await db.query(insertQuery, [
            apartmentId,
            bankAccount,
            operationType,
            referenceNumber,
            amount, // El monto en USD
            currency, // 'VES' o 'USD'
            parseFloat(exchangeRate), // Ej. 736.9339
            amountLocal ? parseFloat(amountLocal) : amount, // El equivalente en Bs.
            operationDate,
        ]);

        res.status(201).json({
            message:
                "Reporte de pago enviado con éxito. Pendiente de aprobación.",
        });
    } catch (error) {
        console.error("Error al registrar pago:", error);
        res.status(500).json({ message: "Error interno al procesar el pago." });
    }
};

//Endpoint para ver pagos reportados
const getMyPayments = async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
        SELECT 
            p.id, 
            p.bank_account, 
            p.reference, 
            p.amount, 
            p.payment_date, 
            p.status,
            a.number as apartment_number
        FROM payments p
        JOIN apartments a ON p.apartment_id = a.id
        WHERE a.owner_id = ?
        ORDER BY p.created_at DESC 
        LIMIT 5
        `;
        const [payments] = await db.query(query, [userId]);
        res.json({ data: payments });
    } catch (error) {
        res.status(500).json({ message: "Error al obtener pagos" });
    }
};

// Obtener todos los pagos del edificio que administra
const getBuildingPayments = async (req, res) => {
    const adminId = req.user.id;
    try {
        const query = `
            SELECT 
                p.id, 
                a.number as apartment, 
                u.name as ownerName, 
                p.amount, 
                DATE_FORMAT(p.payment_date, '%Y-%m-%d') as date, 
                p.status, 
                p.bank_account as method, 
                p.reference,
                b.name as buildingName,
                p.currency,
                p.exchange_rate,
                p.amount_local,
                p.payment_date
            FROM payments p
            JOIN apartments a ON p.apartment_id = a.id
            JOIN buildings b ON a.building_id = b.id
            LEFT JOIN users u ON a.owner_id = u.id
            LEFT JOIN residential_complexes rc ON b.complex_id = rc.id
            WHERE b.admin_id = ? OR rc.admin_id = ?
            ORDER BY p.created_at DESC
        `;
        const [payments] = await db.query(query, [adminId, adminId]);
        res.json({ data: payments });
    } catch (error) {
        res.status(500).json({
            message: "Error al obtener pagos del edificio",
        });
    }
};

// Aprobar un pago
const approvePayment = async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Obtener la información del pago reportado
        const [payments] = await connection.query(
            "SELECT apartment_id, amount FROM payments WHERE id = ? AND status = 'PENDING_APPROVAL'",
            [id],
        );

        if (payments.length === 0) {
            throw new Error("Pago no encontrado o ya procesado");
        }

        let remainingAmount = parseFloat(payments[0].amount);
        const apartmentId = payments[0].apartment_id;

        // 2. Buscar todos los recibos con deuda (PENDING o PARTIAL) ordenados por antigüedad
        // El FOR UPDATE bloquea estas filas en la BD mientras hacemos la matemática
        const [receipts] = await connection.query(
            "SELECT id, amount, paid FROM receipts WHERE apartment_id = ? AND status IN ('PENDING', 'PARTIAL') ORDER BY issue_date ASC FOR UPDATE",
            [apartmentId],
        );

        // 3. PROCESO DE CASCADA (FIFO)
        for (let receipt of receipts) {
            if (remainingAmount <= 0) break; // Si se agotó el dinero, salimos

            const totalAmount = parseFloat(receipt.amount);
            const alreadyPaid = parseFloat(receipt.paid || 0);
            const pendingOnThisReceipt = totalAmount - alreadyPaid;

            if (pendingOnThisReceipt <= 0) continue; // Seguro por si acaso

            // Calculamos cuánto dinero se le va a inyectar a este recibo
            const allocated = Math.min(remainingAmount, pendingOnThisReceipt);

            // A) Insertamos en la tabla intermedia (El cruce contable)
            await connection.query(
                "INSERT INTO payment_receipts (payment_id, receipt_id, allocated_amount) VALUES (?, ?, ?)",
                [id, receipt.id, allocated],
            );

            // B) Actualizamos el recibo
            const newPaidAmount = alreadyPaid + allocated;

            // Evaluamos si con este abono se pagó completo o quedó parcial
            // Usamos .toFixed(2) para curarnos en salud con los decimales falsos de JavaScript
            const isFullyPaid =
                newPaidAmount.toFixed(2) >= totalAmount.toFixed(2);
            const newStatus = isFullyPaid ? "PAID" : "PARTIAL";

            await connection.query(
                "UPDATE receipts SET paid = ?, status = ? WHERE id = ?",
                [newPaidAmount, newStatus, receipt.id],
            );

            // Restamos lo usado al pozo de dinero del pago
            remainingAmount -= allocated;
        }

        // 4. Marcar el reporte de pago como APROBADO
        await connection.query(
            "UPDATE payments SET status = 'APPROVED' WHERE id = ?",
            [id],
        );

        await connection.commit();
        res.json({
            message: "Pago procesado y aplicado a la deuda exitosamente",
        });
    } catch (error) {
        console.log("Error en approvePayment:", error);
        await connection.rollback();
        res.status(500).json({ message: error.message });
    } finally {
        connection.release();
    }
};

module.exports = {
    reportPayment,
    getMyPayments,
    getBuildingPayments,
    approvePayment,
};
