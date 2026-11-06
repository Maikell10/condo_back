const pool = require("../db.js");
const axios = require("axios");
const https = require("https");

/**
 * Persiste USD en una sola fila (UPDATE; INSERT si no existe).
 */
async function upsertUsdRate(rate, rateDate) {
    const updateQuery = `
            UPDATE exchange_rates 
            SET rate = ?, 
                rate_date = ? 
            WHERE currency = 'USD'
        `;

    const [result] = await pool.query(updateQuery, [rate, rateDate]);

    if (result.affectedRows === 0) {
        console.warn(
            "⚠️ No se encontró currency = 'USD'. Creando registro inicial...",
        );
        await pool.query(
            "INSERT INTO exchange_rates (currency, rate, rate_date) VALUES ('USD', ?, ?)",
            [rate, rateDate],
        );
    } else {
        console.log(
            `[BCV] Fila USD actualizada. Tasa: ${rate} (fecha valor: ${rateDate})`,
        );
    }
}

/**
 * Lee tasa USD con metadatos para admin (incluye updated_at si existe en DDL).
 */
async function selectUsdRowAdmin() {
    const [rows] = await pool.query(
        "SELECT * FROM exchange_rates WHERE currency = 'USD' LIMIT 1",
    );
    return rows?.[0] ?? null;
}

const getTasa = async (req, res) => {
    try {
        const query =
            "SELECT rate, rate_date FROM exchange_rates WHERE currency = 'USD' LIMIT 1";
        const [rows] = await pool.query(query);

        // Si rows está vacío o no es un array válido, enviamos un objeto por defecto controlado
        if (!rows || rows.length === 0) {
            return res.status(200).json({
                success: false,
                data: {
                    rate: 1.0,
                    rate_date: new Date().toISOString().split("T")[0],
                },
                message:
                    "No se encontró la tasa en la BD, se envía tasa base 1",
            });
        }

        // Retornamos exactamente la estructura que espera tu Angular
        return res.status(200).json({
            success: true,
            data: rows[0],
        });
    } catch (error) {
        console.error("Error crítico en getTasa:", error.message);
        return res.status(500).json({
            success: false,
            message: "Error interno al obtener la tasa",
        });
    }
};

/** GET — Super Admin: tasa + fechas (actualización DB + fecha valor BCV). */
const getTasaAdmin = async (req, res) => {
    try {
        const row = await selectUsdRowAdmin();
        if (!row) {
            return res.status(200).json({
                success: false,
                message: "No hay fila USD en exchange_rates",
                data: null,
            });
        }
        return res.status(200).json({ success: true, data: row });
    } catch (error) {
        console.error("getTasaAdmin:", error.message);
        return res.status(500).json({
            success: false,
            message: "Error al leer la tasa",
        });
    }
};

/** PUT — Super Admin: editar manualmente rate y rate_date (misma fila USD). */
const putTasaUsd = async (req, res) => {
    try {
        const rate = parseFloat(req.body?.rate);
        const rateDate = req.body?.rate_date;

        if (Number.isNaN(rate) || rate <= 0) {
            return res.status(400).json({
                success: false,
                message: "rate debe ser un número mayor que 0",
            });
        }
        if (
            typeof rateDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(rateDate.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "rate_date debe ser YYYY-MM-DD",
            });
        }

        await upsertUsdRate(rate, rateDate.trim());
        const row = await selectUsdRowAdmin();
        return res.status(200).json({
            success: true,
            message: "Tasa actualizada",
            data: row,
        });
    } catch (error) {
        console.error("putTasaUsd:", error.message);
        return res.status(500).json({
            success: false,
            message: "Error al guardar la tasa",
        });
    }
};

/**
 * Descarga HTML del BCV, persiste USD y devuelve la fila leída de BD.
 */
async function syncTasaFromBCV() {
    const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
    });

    const response = await axios.get("https://www.bcv.org.ve/", {
        timeout: 10000,
        httpsAgent: httpsAgent,
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            Connection: "keep-alive",
        },
    });

    const html = response.data;

    const dolarRegex =
        /id="dolar"[\s\S]*?<strong[^>]*?>\s*([\d.,]+)\s*<\/strong>/i;
    const match = html.match(dolarRegex);

    if (!match || !match[1]) {
        throw new Error(
            "No se pudo encontrar el valor del dólar en el HTML del BCV.",
        );
    }

    const tasaClean = parseFloat(match[1].trim().replace(",", "."));

    const fechaRegex = /content="(\d{4}-\d{2}-\d{2})T/i;
    const fechaMatch = html.match(fechaRegex);
    const fechaValor = fechaMatch
        ? fechaMatch[1]
        : new Date().toISOString().split("T")[0];

    await upsertUsdRate(tasaClean, fechaValor);
    const row = await selectUsdRowAdmin();
    return row;
}

const setTasaBCV = async () => {
    try {
        await syncTasaFromBCV();
    } catch (error) {
        console.error("Error en setTasaBCV:", error.message);
    }
};

/** POST — Super Admin: misma lógica que el cron BCV, respuesta con fila actualizada. */
const postRefreshTasaBCV = async (req, res) => {
    try {
        const row = await syncTasaFromBCV();
        return res.status(200).json({
            success: true,
            message: "Tasa cargada desde el BCV",
            data: row,
        });
    } catch (error) {
        console.error("postRefreshTasaBCV:", error.message);
        return res.status(502).json({
            success: false,
            message: error.message || "No se pudo obtener la tasa del BCV",
        });
    }
};

module.exports = {
    getTasa,
    getTasaAdmin,
    putTasaUsd,
    postRefreshTasaBCV,
    setTasaBCV,
};
