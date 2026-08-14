const db = require("../db");

// ==========================================================
// 1. Obtener listado general (Dashboard)
// ==========================================================
const getSaaSDashboard = async (req, res) => {
    try {
        // Obtenemos todos los usuarios con rol BUILDING_ADMIN
        // Cruzamos con suscripciones, y usamos subconsultas para determinar el Scope y buscar la factura actual
        const query = `
            SELECT 
                u.id as admin_id,
                u.name,
                u.email,
                
                -- Determinar Alcance: Buscamos si tiene complejos o edificios independientes
                (SELECT COUNT(*) FROM residential_complexes rc WHERE rc.admin_id = u.id) as complex_count,
                (SELECT COUNT(*) FROM buildings b WHERE b.admin_id = u.id) as building_count,
                
                -- Nombres para el Frontend
                (SELECT name FROM residential_complexes rc WHERE rc.admin_id = u.id LIMIT 1) as complex_name,
                (SELECT name FROM buildings b WHERE b.admin_id = u.id LIMIT 1) as first_building_name,
                
                -- Datos de Suscripción (IFNULL para los que aún no tengan configuración)
                IFNULL(s.fee_amount, 0) as feeAmount,
                IFNULL(s.currency, 'USD') as currency,
                IFNULL(s.local_currency, 'BS') as localCurrency,
                s.due_days,
                
                -- Factura del mes actual (Si existe)
                i.id as current_invoice_id,
                i.period_month,
                i.period_year,
                i.status as invoice_status,
                i.due_date,
                
                -- Fecha de pago si ya pagó este mes
                (SELECT payment_date FROM saas_payments p WHERE p.invoice_id = i.id ORDER BY payment_date DESC LIMIT 1) as paymentDate

            FROM users u
            LEFT JOIN saas_subscriptions s ON u.id = s.admin_id
            
            -- Buscamos la factura del mes y año actual
            LEFT JOIN saas_invoices i ON u.id = i.admin_id 
                AND i.period_month = MONTH(CURRENT_DATE()) 
                AND i.period_year = YEAR(CURRENT_DATE())

            WHERE u.role = 'BUILDING_ADMIN'
        `;

        const [rows] = await db.query(query);

        // Formateamos los datos para que Angular (Frontend) los reciba exactamente como en los Mocks
        const formattedData = rows.map((admin) => {
            const isComplex = admin.complex_count > 0;

            return {
                id: admin.admin_id,
                name: admin.name,
                email: admin.email,
                scope: isComplex ? "COMPLEX" : "SINGLE",
                scopeName: isComplex
                    ? `${admin.complex_name} (${admin.building_count} Edificios)`
                    : admin.first_building_name || "Sin Edificios Asignados",

                billingConfig: {
                    feeAmount: Number(admin.feeAmount),
                    currency: admin.currency,
                    localCurrency: admin.localCurrency,
                    exchangeRate: 1, // Aquí podrías integrar una API de cambio de divisas en el futuro
                },

                currentPeriod: {
                    month: new Date()
                        .toLocaleString("es-ES", {
                            month: "long",
                            year: "numeric",
                        })
                        .toUpperCase(),
                    // Si no tiene factura generada, por defecto es PENDING
                    status: admin.invoice_status || "PENDING",
                    dueDate: admin.due_date,
                    paymentDate: admin.paymentDate,
                },
            };
        });

        res.json({ success: true, data: formattedData });
    } catch (error) {
        console.error("Error en getSaaSDashboard:", error);
        res.status(500).json({
            success: false,
            message: "Error al cargar el dashboard SaaS",
        });
    }
};

// ==========================================================
// 2. Configurar Tarifa del Administrador (Crear o Actualizar)
// ==========================================================
const updateSubscription = async (req, res) => {
    const { admin_id, fee_amount, currency, local_currency, due_days } =
        req.body;

    try {
        const query = `
            INSERT INTO saas_subscriptions (admin_id, fee_amount, currency, local_currency, due_days) 
            VALUES (?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE 
            fee_amount = VALUES(fee_amount), 
            currency = VALUES(currency), 
            local_currency = VALUES(local_currency), 
            due_days = VALUES(due_days)
        `;

        await db.query(query, [
            admin_id,
            fee_amount,
            currency || "USD",
            local_currency || "BS",
            due_days || 5,
        ]);

        res.json({
            success: true,
            message: "Configuración de suscripción actualizada.",
        });
    } catch (error) {
        console.error("Error en updateSubscription:", error);
        res.status(500).json({
            success: false,
            message: "Error al actualizar la suscripción",
        });
    }
};

// ==========================================================
// 3. Registrar el Pago del Administrador
// ==========================================================
const registerPayment = async (req, res) => {
    const {
        admin_id,
        amount_paid,
        payment_method,
        reference_number,
        payment_date,
        notes,
    } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Buscamos la factura no pagada más antigua de ese admin (Lógica FIFO)
        const [invoices] = await connection.query(
            "SELECT id FROM saas_invoices WHERE admin_id = ? AND status IN ('PENDING', 'OVERDUE') ORDER BY issue_date ASC LIMIT 1 FOR UPDATE",
            [admin_id],
        );

        if (invoices.length === 0) {
            throw new Error(
                "El cliente no tiene facturas pendientes o en mora.",
            );
        }

        const invoiceId = invoices[0].id;

        // Insertamos el registro del pago
        await connection.query(
            `INSERT INTO saas_payments (invoice_id, admin_id, amount_paid, payment_method, reference_number, payment_date, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                invoiceId,
                admin_id,
                amount_paid,
                payment_method,
                reference_number,
                payment_date,
                notes,
            ],
        );

        // Marcamos la factura como Pagada
        await connection.query(
            "UPDATE saas_invoices SET status = 'PAID' WHERE id = ?",
            [invoiceId],
        );

        await connection.commit();
        res.json({
            success: true,
            message: "Pago registrado y factura solventada.",
        });
    } catch (error) {
        await connection.rollback();
        console.error("Error en registerPayment:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Error al procesar el pago",
        });
    } finally {
        connection.release();
    }
};

// ==========================================================
// 4. Obtener el Historial de Pagos de un Admin
// ==========================================================
const getPaymentHistory = async (req, res) => {
    const { admin_id } = req.params;

    try {
        const query = `
            SELECT 
                p.id, 
                p.amount_paid, 
                p.payment_method, 
                p.reference_number, 
                p.payment_date, 
                p.notes,
                i.period_month, 
                i.period_year,
                i.currency
            FROM saas_payments p
            INNER JOIN saas_invoices i ON p.invoice_id = i.id
            WHERE p.admin_id = ?
            ORDER BY p.payment_date DESC
        `;

        const [history] = await db.query(query, [admin_id]);

        res.json({ success: true, data: history });
    } catch (error) {
        console.error("Error en getPaymentHistory:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener historial de pagos",
        });
    }
};

// ==========================================================
// 5. CRON JOB: Generación Automática de Facturas SaaS
// ==========================================================
const generateMonthlyInvoices = async (req, res) => {
    // Definimos el mes y el año actual
    const currentDate = new Date();
    const periodMonth = currentDate.getMonth() + 1; // getMonth() devuelve 0-11
    const periodYear = currentDate.getFullYear();
    const issueDateStr = `${periodYear}-${periodMonth.toString().padStart(2, "0")}-01`;

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Obtener todas las suscripciones activas
        const [subscriptions] = await connection.query(
            "SELECT admin_id, fee_amount, currency, due_days FROM saas_subscriptions WHERE status = 'ACTIVE' AND fee_amount > 0",
        );

        if (subscriptions.length === 0) {
            await connection.rollback();
            return res.json({
                success: true,
                message: "No hay suscripciones activas para facturar.",
            });
        }

        let invoicesCreated = 0;

        for (const sub of subscriptions) {
            // 2. Verificar si este administrador ya tiene una factura para ESTE mes
            const [existingInvoice] = await connection.query(
                "SELECT id FROM saas_invoices WHERE admin_id = ? AND period_month = ? AND period_year = ?",
                [sub.admin_id, periodMonth, periodYear],
            );

            if (existingInvoice.length === 0) {
                // 3. Calcular la fecha de vencimiento (dueDate) sumando los due_days a la issue_date
                // Ej: Si issueDate es 2026-08-01 y due_days es 5, dueDate será 2026-08-06
                const dueDateObj = new Date(
                    currentDate.getFullYear(),
                    currentDate.getMonth(),
                    1 + sub.due_days,
                );
                const dueDateStr = dueDateObj.toISOString().split("T")[0];

                // 4. Insertar la nueva factura
                await connection.query(
                    `INSERT INTO saas_invoices 
                    (admin_id, period_month, period_year, fee_amount, currency, exchange_rate, issue_date, due_date, status) 
                    VALUES (?, ?, ?, ?, ?, 1.0000, ?, ?, 'PENDING')`,
                    [
                        sub.admin_id,
                        periodMonth,
                        periodYear,
                        sub.fee_amount,
                        sub.currency,
                        issueDateStr,
                        dueDateStr,
                    ],
                );

                invoicesCreated++;
            }
        }

        // 5. Proceso de actualización de MOROSIDAD automática
        // Si hay facturas PENDING cuya fecha de vencimiento (due_date) ya pasó, las pasamos a OVERDUE
        const todayStr = currentDate.toISOString().split("T")[0];
        const [updateResult] = await connection.query(
            "UPDATE saas_invoices SET status = 'OVERDUE' WHERE status = 'PENDING' AND due_date < ?",
            [todayStr],
        );

        await connection.commit();
        res.json({
            success: true,
            message: `Proceso completado. Se generaron ${invoicesCreated} nuevas facturas. Se actualizaron ${updateResult.affectedRows} facturas vencidas a estado MOROSO.`,
        });
    } catch (error) {
        await connection.rollback();
        console.error("Error en generateMonthlyInvoices (CRON):", error);
        res.status(500).json({
            success: false,
            message: "Error al generar facturas masivas",
        });
    } finally {
        connection.release();
    }
};

module.exports = {
    getSaaSDashboard,
    updateSubscription,
    registerPayment,
    getPaymentHistory,
    generateMonthlyInvoices,
};
