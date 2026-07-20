const pool = require("../db.js");
const moment = require("moment");
const axios = require("axios");
const https = require("https");

const setTasaBCV = async (req, res) => {
    try {
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

        // 1. Extraer la tasa del Dólar
        const dolarRegex =
            /id="dolar"[\s\S]*?<strong[^>]*?>\s*([\d.,]+)\s*<\/strong>/i;
        const match = html.match(dolarRegex);

        if (!match || !match[1]) {
            throw new Error(
                "No se pudo encontrar el valor del dólar en el HTML del BCV.",
            );
        }

        const tasaRaw = match[1];
        const tasaClean = parseFloat(tasaRaw.trim().replace(",", "."));

        // 2. Extraer la fecha valor real del BCV (ej: "2026-07-20")
        const fechaRegex = /content="(\d{4}-\d{2}-\d{2})T/i;
        const fechaMatch = html.match(fechaRegex);

        // Si por algún motivo falla la regex de la fecha, usamos la fecha de hoy como salvavidas
        const fechaValor = fechaMatch
            ? fechaMatch[1]
            : new Date().toISOString().split("T")[0];

        // 3. Guardar en Base de Datos
        // Modifica únicamente los valores de la moneda base 'USD' sin crear filas nuevas cada día
        const updateQuery = `
            UPDATE exchange_rates 
            SET rate = ?, 
                rate_date = ? 
            WHERE currency = 'USD'
        `;

        const [result] = await pool.query(updateQuery, [tasaClean, fechaValor]);

        // Verificación por si acaso borraste la fila de la BD sin querer
        if (result.affectedRows === 0) {
            console.warn(
                "⚠️ Alerta: No se encontró la fila con currency = 'USD'. Creando registro inicial...",
            );
            await pool.query(
                "INSERT INTO exchange_rates (currency, rate, rate_date) VALUES ('USD', ?, ?)",
                [tasaClean, fechaValor],
            );
        } else {
            console.log(
                `[BCV] Fila 'USD' actualizada con éxito. Nueva tasa: ${tasaClean} (Fecha Valor: ${fechaValor})`,
            );
        }
    } catch (error) {
        console.error("Error en setTasaBCV:", error.message);
    }
};

const getTasa = async (req, res) => {
    try {
        const query = `
            SELECT rate, rate_date FROM exchange_rates WHERE currency = 'USD' LIMIT 1
        `;
        // [rows] extrae el array de filas de la respuesta de mysql2
        const [rows] = await pool.query(query);

        if (!rows || rows.length === 0) {
            return res
                .status(404)
                .json({ message: "No se encontró la tasa de cambio USD" });
        }

        // Devolvemos la primera fila encontrada como un objeto directo
        res.json({ data: rows[0] });
    } catch (error) {
        console.error("Error en getTasa:", error);
        res.status(500).json({ message: "Error al obtener la tasa" });
    }
};

module.exports = {
    setTasaBCV,
    getTasa,
};
