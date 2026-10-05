const db = require("../db");
const {
    SAAS_TZ_OFFSET_HOURS,
    getSaasCalendarParts,
    getSaasBillingPeriodForCreation,
    saasDueDateYmd,
} = require("../utils/saas-time");

const saasOffset = Number(SAAS_TZ_OFFSET_HOURS) || 0;
const saasNowSql = `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${saasOffset} HOUR)`;
const SAAS_TEST_USER_EXCLUDE_SQL = `
    NOT (
        LOWER(TRIM(u.email)) = 'edificio1@condomanager.com'
        OR LOWER(TRIM(u.email)) LIKE '%@condomanager.com'
    )
`;
/** Periodo facturado = mes anterior al calendario SaaS actual */
const saasBillablePeriodMonthSql = `
    IF(MONTH(${saasNowSql}) = 1, 12, MONTH(${saasNowSql}) - 1)
`;
const saasBillablePeriodYearSql = `
    IF(MONTH(${saasNowSql}) = 1, YEAR(${saasNowSql}) - 1, YEAR(${saasNowSql}))
`;

const isTestSaasAccount = (email) => {
    const e = String(email || "").toLowerCase().trim();
    if (!e) return false;
    if (e === "edificio1@condomanager.com") return true;
    if (e.endsWith("@condomanager.com")) return true;
    return /(\+test|testing|prueba|demo)@/i.test(e);
};

const SAAS_ADMIN_SCOPE_SQL = `
    (SELECT COUNT(*) FROM residential_complexes rc WHERE rc.admin_id = u.id) as complex_count,
    (SELECT COUNT(*) FROM buildings b WHERE b.admin_id = u.id) as building_count,
    (SELECT name FROM residential_complexes rc WHERE rc.admin_id = u.id LIMIT 1) as complex_name,
    (SELECT name FROM buildings b WHERE b.admin_id = u.id LIMIT 1) as first_building_name
`;

const SAAS_OPEN_INVOICE_SUMMARY_SQL = `
    (SELECT COUNT(*) FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')) as open_invoice_count,
    (SELECT COALESCE(SUM(oi.fee_amount), 0) FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')) as open_balance,
    (SELECT oi.id FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')
        ORDER BY oi.issue_date ASC LIMIT 1) as next_invoice_id,
    (SELECT oi.period_month FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')
        ORDER BY oi.issue_date ASC LIMIT 1) as next_period_month,
    (SELECT oi.period_year FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')
        ORDER BY oi.issue_date ASC LIMIT 1) as next_period_year,
    (SELECT oi.fee_amount FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')
        ORDER BY oi.issue_date ASC LIMIT 1) as next_fee_amount,
    (SELECT oi.due_date FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')
        ORDER BY oi.issue_date ASC LIMIT 1) as next_due_date,
    (SELECT oi.status FROM saas_invoices oi
        WHERE oi.admin_id = u.id AND oi.status IN ('PENDING', 'OVERDUE')
        ORDER BY oi.issue_date ASC LIMIT 1) as next_invoice_status
`;

const compareSaasRowsByLastPayment = (a, b) => {
    const toTime = (row) => {
        const raw = row?.last_payment_date;
        if (!raw) return 0;
        const s = String(raw).slice(0, 10);
        const t = Date.parse(`${s}T12:00:00Z`);
        return Number.isNaN(t) ? 0 : t;
    };
    const diff = toTime(b) - toTime(a);
    if (diff !== 0) return diff;
    return String(a.name || "").localeCompare(String(b.name || ""), "es");
};

const formatSaasDashboardRow = (admin) => {
    const isComplex = admin.complex_count > 0;
    const isTest = isTestSaasAccount(admin.email);
    const accountStatus = admin.account_status || "ACTIVE";
    const includeInMetrics = accountStatus === "ACTIVE" && !isTest;

    return {
        id: admin.admin_id,
        name: admin.name,
        email: admin.email,
        accountStatus,
        subscriptionStatus: admin.subscription_status || "ACTIVE",
        isTestAccount: isTest,
        includeInMetrics,
        hasSubscription: !!admin.has_subscription,
        scope: isComplex ? "COMPLEX" : "SINGLE",
        scopeName: isComplex
            ? `${admin.complex_name} (${admin.building_count} Edificios)`
            : admin.first_building_name || "Sin Edificios Asignados",

        billingConfig: {
            feeAmount: Number(admin.feeAmount || 0),
            currency: admin.currency || "USD",
            localCurrency: admin.localCurrency || "BS",
            exchangeRate: 1,
        },

        currentPeriod: {
            month: (() => {
                const { periodYear, periodMonth } =
                    getSaasBillingPeriodForCreation();
                return new Date(Date.UTC(periodYear, periodMonth - 1, 1))
                    .toLocaleString("es-ES", {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                    })
                    .toUpperCase();
            })(),
            status: (() => {
                if (isTest) return "PAID";
                if (accountStatus !== "ACTIVE") return "INACTIVE";
                const totalInv = Number(admin.total_invoice_count || 0);
                if (!admin.invoice_status && totalInv === 0) return "NONE";
                return admin.invoice_status || "PENDING";
            })(),
            dueDate: admin.due_date,
            paymentDate: admin.paymentDate,
        },

        totalInvoices: Number(admin.total_invoice_count || 0),

        openInvoices: {
            count: Number(admin.open_invoice_count || 0),
            totalAmount: Number(admin.open_balance || 0),
            currency: admin.currency || "USD",
        },
        nextOpenInvoice: admin.next_invoice_id
            ? {
                  id: admin.next_invoice_id,
                  periodMonth: admin.next_period_month,
                  periodYear: admin.next_period_year,
                  feeAmount: Number(admin.next_fee_amount || 0),
                  currency: admin.currency || "USD",
                  dueDate: admin.next_due_date,
                  status: admin.next_invoice_status || "PENDING",
              }
            : null,
        lastPaymentDate: admin.last_payment_date || null,
    };
};

// ==========================================================
// 1. Obtener listado general (Dashboard)
// ==========================================================
const getSaaSDashboard = async (req, res) => {
    try {
        const subscriptionQuery = `
            SELECT 
                u.id as admin_id,
                u.name,
                u.email,
                u.status as account_status,
                sub.status as subscription_status,
                1 as has_subscription,
                ${SAAS_ADMIN_SCOPE_SQL},
                sub.fee_amount as feeAmount,
                IFNULL(sub.currency, 'USD') as currency,
                IFNULL(sub.local_currency, 'BS') as localCurrency,
                sub.due_days,
                ${SAAS_OPEN_INVOICE_SUMMARY_SQL},
                i.id as current_invoice_id,
                i.period_month,
                i.period_year,
                i.status as invoice_status,
                i.due_date,
                (SELECT payment_date FROM saas_payments p WHERE p.invoice_id = i.id ORDER BY payment_date DESC LIMIT 1) as paymentDate,
                (SELECT p.payment_date FROM saas_payments p
                    WHERE p.admin_id = u.id
                    ORDER BY p.payment_date DESC, p.id DESC LIMIT 1) as last_payment_date,
                (SELECT COUNT(*) FROM saas_invoices oi
                    WHERE oi.admin_id = u.id) as total_invoice_count
            FROM saas_subscriptions sub
            INNER JOIN users u ON u.id = sub.admin_id
            LEFT JOIN saas_invoices i ON u.id = i.admin_id 
                AND i.period_month = ${saasBillablePeriodMonthSql}
                AND i.period_year = ${saasBillablePeriodYearSql}
        `;

        const [subscriptionRows] = await db.query(subscriptionQuery);

        const subscribedIds = subscriptionRows.map((r) => r.admin_id);

        // Cuentas demo (ej. edificio1@condomanager.com) sin fila en saas_subscriptions
        const testOnlyQuery = `
            SELECT 
                u.id as admin_id,
                u.name,
                u.email,
                u.status as account_status,
                NULL as subscription_status,
                0 as has_subscription,
                ${SAAS_ADMIN_SCOPE_SQL},
                0 as feeAmount,
                'USD' as currency,
                'BS' as localCurrency,
                NULL as due_days,
                0 as open_invoice_count,
                0 as open_balance,
                NULL as next_invoice_id,
                NULL as next_period_month,
                NULL as next_period_year,
                NULL as next_fee_amount,
                NULL as next_due_date,
                NULL as next_invoice_status,
                NULL as current_invoice_id,
                NULL as period_month,
                NULL as period_year,
                NULL as invoice_status,
                NULL as due_date,
                NULL as paymentDate,
                NULL as last_payment_date,
                0 as total_invoice_count
            FROM users u
            WHERE u.role = 'BUILDING_ADMIN'
              AND (
                LOWER(TRIM(u.email)) = 'edificio1@condomanager.com'
                OR LOWER(TRIM(u.email)) LIKE '%@condomanager.com'
              )
              ${subscribedIds.length ? "AND u.id NOT IN (?)" : ""}
        `;

        const [testRows] = subscribedIds.length
            ? await db.query(testOnlyQuery, [subscribedIds])
            : await db.query(testOnlyQuery);

        const allRows = [...subscriptionRows, ...testRows].sort(
            compareSaasRowsByLastPayment,
        );

        const formattedData = allRows.map((row) => formatSaasDashboardRow(row));

        const [[collectionRow]] = await db.query(
            `SELECT COALESCE(SUM(p.amount_paid), 0) AS collected_this_month
             FROM saas_payments p
             INNER JOIN users u ON u.id = p.admin_id
             WHERE u.status = 'ACTIVE'
               AND ${SAAS_TEST_USER_EXCLUDE_SQL}
               AND YEAR(p.payment_date) = YEAR(${saasNowSql})
               AND MONTH(p.payment_date) = MONTH(${saasNowSql})`,
        );

        res.json({
            success: true,
            data: formattedData,
            stats: {
                collectedThisMonth: Number(
                    collectionRow?.collected_this_month || 0,
                ),
            },
        });
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
        invoice_id,
        amount_paid,
        payment_method,
        reference_number,
        payment_date,
        notes,
    } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        let invoiceRow;
        if (invoice_id) {
            const [invoices] = await connection.query(
                `SELECT id, period_month, period_year, fee_amount, currency
                 FROM saas_invoices
                 WHERE id = ? AND admin_id = ? AND status IN ('PENDING', 'OVERDUE')
                 FOR UPDATE`,
                [invoice_id, admin_id],
            );
            if (invoices.length === 0) {
                throw new Error(
                    "La factura indicada no existe, no pertenece al cliente o ya está pagada.",
                );
            }
            invoiceRow = invoices[0];
        } else {
            const [invoices] = await connection.query(
                `SELECT id, period_month, period_year, fee_amount, currency
                 FROM saas_invoices
                 WHERE admin_id = ? AND status IN ('PENDING', 'OVERDUE')
                 ORDER BY issue_date ASC LIMIT 1 FOR UPDATE`,
                [admin_id],
            );
            if (invoices.length === 0) {
                throw new Error(
                    "El cliente no tiene facturas pendientes o en mora.",
                );
            }
            invoiceRow = invoices[0];
        }

        const invoiceId = invoiceRow.id;

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
            message: `Pago aplicado a factura ${String(invoiceRow.period_month).padStart(2, "0")}/${invoiceRow.period_year}.`,
            data: {
                invoice_id: invoiceId,
                period_month: invoiceRow.period_month,
                period_year: invoiceRow.period_year,
                amount_paid,
                currency: invoiceRow.currency,
            },
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
// 4. Facturas de un administrador (todas)
// ==========================================================
const getInvoiceDocument = async (req, res) => {
    const invoiceId = Number(req.params.invoice_id);
    if (!invoiceId) {
        return res.status(400).json({
            success: false,
            message: "invoice_id inválido",
        });
    }

    try {
        const query = `
            SELECT
                i.id,
                i.admin_id,
                i.period_month,
                i.period_year,
                i.fee_amount,
                i.currency,
                i.issue_date,
                i.due_date,
                i.status,
                u.name AS admin_name,
                u.email AS admin_email,
                (SELECT rc.name FROM residential_complexes rc
                    WHERE rc.admin_id = u.id AND rc.status = 'ACTIVE' LIMIT 1) AS complex_name,
                (SELECT rc.direccion FROM residential_complexes rc
                    WHERE rc.admin_id = u.id AND rc.status = 'ACTIVE' LIMIT 1) AS complex_address,
                (SELECT b.name FROM buildings b
                    WHERE b.admin_id = u.id AND b.status = 'ACTIVE' LIMIT 1) AS building_name,
                (SELECT b.address FROM buildings b
                    WHERE b.admin_id = u.id AND b.status = 'ACTIVE' LIMIT 1) AS building_address,
                (SELECT p.amount_paid FROM saas_payments p
                    WHERE p.invoice_id = i.id
                    ORDER BY p.payment_date DESC, p.id DESC LIMIT 1) AS amount_paid,
                (SELECT p.payment_method FROM saas_payments p
                    WHERE p.invoice_id = i.id
                    ORDER BY p.payment_date DESC, p.id DESC LIMIT 1) AS payment_method,
                (SELECT p.reference_number FROM saas_payments p
                    WHERE p.invoice_id = i.id
                    ORDER BY p.payment_date DESC, p.id DESC LIMIT 1) AS reference_number,
                (SELECT p.payment_date FROM saas_payments p
                    WHERE p.invoice_id = i.id
                    ORDER BY p.payment_date DESC, p.id DESC LIMIT 1) AS payment_date
            FROM saas_invoices i
            INNER JOIN users u ON u.id = i.admin_id
            WHERE i.id = ?
        `;
        const [rows] = await db.query(query, [invoiceId]);
        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: "Factura no encontrada",
            });
        }

        const row = rows[0];
        const clientName =
            row.complex_name || row.building_name || row.admin_name;
        const clientAddress =
            row.complex_address || row.building_address || "";

        res.json({
            success: true,
            data: {
                invoice: {
                    id: row.id,
                    adminId: row.admin_id,
                    periodMonth: row.period_month,
                    periodYear: row.period_year,
                    feeAmount: Number(row.fee_amount),
                    currency: row.currency,
                    issueDate: row.issue_date,
                    dueDate: row.due_date,
                    status: row.status,
                    number: String(row.id).padStart(4, "0"),
                },
                client: {
                    name: clientName,
                    address: clientAddress,
                    contactName: row.admin_name,
                    email: row.admin_email,
                    rif: "",
                    phone: "",
                },
                payment:
                    row.status === "PAID"
                        ? {
                              amountPaid: Number(row.amount_paid || 0),
                              method: row.payment_method,
                              reference: row.reference_number,
                              paymentDate: row.payment_date,
                          }
                        : null,
            },
        });
    } catch (error) {
        console.error("Error en getInvoiceDocument:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener datos de la factura",
        });
    }
};

const getAdminInvoices = async (req, res) => {
    const adminId = Number(req.params.admin_id);
    if (!adminId) {
        return res.status(400).json({
            success: false,
            message: "admin_id inválido",
        });
    }

    try {
        const query = `
            SELECT
                i.id,
                i.admin_id,
                i.period_month,
                i.period_year,
                i.fee_amount,
                i.currency,
                i.issue_date,
                i.due_date,
                i.status,
                (SELECT p.payment_date FROM saas_payments p
                    WHERE p.invoice_id = i.id
                    ORDER BY p.payment_date DESC, p.id DESC LIMIT 1) AS payment_date
            FROM saas_invoices i
            WHERE i.admin_id = ?
            ORDER BY i.period_year DESC, i.period_month DESC, i.id DESC
        `;
        const [rows] = await db.query(query, [adminId]);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error("Error en getAdminInvoices:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener facturas del administrador",
        });
    }
};

// ==========================================================
// 5. Obtener el Historial de Pagos de un Admin
// ==========================================================
const getPaymentHistory = async (req, res) => {
    const { admin_id } = req.params;

    try {
        const query = `
            SELECT 
                p.id, 
                p.admin_id,
                p.amount_paid, 
                p.payment_method, 
                p.reference_number, 
                p.payment_date, 
                p.notes,
                i.period_month, 
                i.period_year,
                i.currency,
                u.name AS admin_name,
                u.email AS admin_email
            FROM saas_payments p
            INNER JOIN saas_invoices i ON p.invoice_id = i.id
            INNER JOIN users u ON u.id = p.admin_id
            WHERE p.admin_id = ?
            ORDER BY p.payment_date DESC, p.id DESC
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

const getAllPaymentHistory = async (req, res) => {
    const { admin_id } = req.query;

    try {
        const conditions = ["1 = 1"];
        const params = [];

        if (admin_id) {
            conditions.push("p.admin_id = ?");
            params.push(Number(admin_id));
        }

        const query = `
            SELECT 
                p.id,
                p.admin_id,
                p.amount_paid,
                p.payment_method,
                p.reference_number,
                p.payment_date,
                p.notes,
                i.period_month,
                i.period_year,
                i.currency,
                u.name AS admin_name,
                u.email AS admin_email,
                (SELECT rc.name FROM residential_complexes rc WHERE rc.admin_id = u.id LIMIT 1) AS complex_name,
                (SELECT b.name FROM buildings b WHERE b.admin_id = u.id LIMIT 1) AS building_name
            FROM saas_payments p
            INNER JOIN saas_invoices i ON p.invoice_id = i.id
            INNER JOIN users u ON u.id = p.admin_id
            WHERE ${conditions.join(" AND ")}
            ORDER BY p.payment_date DESC, p.id DESC
            LIMIT 500
        `;

        const [history] = await db.query(query, params);
        res.json({ success: true, data: history });
    } catch (error) {
        console.error("Error en getAllPaymentHistory:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener el historial de cobranza",
        });
    }
};

// ==========================================================
// 5. CRON JOB: Generación Automática de Facturas SaaS
// ==========================================================
const generateMonthlyInvoices = async (req, res) => {
    const {
        periodYear,
        periodMonth,
        issueYear,
        issueMonth,
        issueDateYmd: issueDateStr,
        ymd: todayStr,
    } = getSaasBillingPeriodForCreation();

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [subscriptions] = await connection.query(
            `SELECT sub.admin_id, sub.fee_amount, sub.currency, sub.due_days
             FROM saas_subscriptions sub
             INNER JOIN users u ON u.id = sub.admin_id
             WHERE sub.status = 'ACTIVE'
               AND sub.fee_amount > 0
               AND u.status = 'ACTIVE'`,
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
                const dueDateStr = saasDueDateYmd(
                    issueYear,
                    issueMonth,
                    sub.due_days,
                );

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
    getAdminInvoices,
    getInvoiceDocument,
    getPaymentHistory,
    getAllPaymentHistory,
    generateMonthlyInvoices,
};
