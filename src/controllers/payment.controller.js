const db = require("../db");

const reportPayment = async (req, res) => {
    const {
        bankAccount,
        operationType,
        referenceNumber,
        amount,
        operationDate,
    } = req.body;
    const userId = req.user.id; // Extraído por el middleware verifyToken

    try {
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

        // 2. Insertamos el reporte de pago
        const query = `
            INSERT INTO payments 
            (apartment_id, bank_account, operation_type, reference, amount, payment_date, status) 
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')
        `;

        await db.query(query, [
            apartmentId,
            bankAccount,
            operationType,
            referenceNumber,
            amount,
            operationDate, // Asegúrate de enviarla en formato YYYY-MM-DD desde Angular
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
            SELECT id, bank_account, reference, amount, payment_date, status 
            FROM payments 
            WHERE apartment_id = (SELECT id FROM apartments WHERE owner_id = ?)
            ORDER BY created_at DESC LIMIT 5
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
            SELECT p.id, a.number as apartment, u.name as ownerName, 
                   p.amount, p.payment_date as date, p.status, p.bank_account as method, p.reference
            FROM payments p
            JOIN apartments a ON p.apartment_id = a.id
            JOIN users u ON a.owner_id = u.id
            WHERE a.building_id = (SELECT id FROM buildings WHERE admin_id = ?)
            ORDER BY p.created_at DESC
        `;
        const [payments] = await db.query(query, [adminId]);
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

        // 2. Buscar todos los recibos pendientes ordenados por antigüedad
        const [receipts] = await connection.query(
            "SELECT id, amount, paid FROM receipts WHERE apartment_id = ? AND status = 'PENDING' ORDER BY issue_date ASC",
            [apartmentId],
        );

        // 3. PROCESO DE CASCADA
        for (let receipt of receipts) {
            if (remainingAmount <= 0) break;

            const totalAmount = parseFloat(receipt.amount);
            const alreadyPaid = parseFloat(receipt.paid || 0);
            const pendingOnThisReceipt = totalAmount - alreadyPaid;

            if (remainingAmount >= pendingOnThisReceipt) {
                // El pago cubre este recibo totalmente (o es mayor)
                await connection.query(
                    "UPDATE receipts SET paid = ?, status = 'PAID' WHERE id = ?",
                    [totalAmount, receipt.id],
                );
                remainingAmount -= pendingOnThisReceipt;
            } else {
                // Pago parcial: El dinero no alcanza para cerrar el recibo
                const newPaidAmount = alreadyPaid + remainingAmount;
                await connection.query(
                    "UPDATE receipts SET paid = ? WHERE id = ?",
                    [newPaidAmount, receipt.id],
                );
                remainingAmount = 0; // Se agotó el dinero
            }
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
        console.log(error);
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
